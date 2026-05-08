import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, StockLotConsumerType } from '@prisma/client';
import { InsufficientStockException } from '../exceptions/insufficient-stock.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { dhakaTodayDateOnly } from '../util/dhaka-time';

type Tx = Prisma.TransactionClient | PrismaClient;

export interface WarehouseSlice {
  stockEntryId: string;
  quantity: number;
  unitCost: number;
}

export interface VanSlice {
  parentAllocationId: string;
  stockEntryId: string;
  quantity: number;
  unitCost: number;
}

export interface AllocateOpts {
  /** Allow consuming expired lots (default false). Use for WASTAGE/DAMAGE write-offs. */
  includeExpired?: boolean;
}

function nonExpiredFilter(today: Date): Prisma.StockEntryWhereInput {
  return { OR: [{ expiryDate: null }, { expiryDate: { gte: today } }] };
}

@Injectable()
export class StockLotService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * FIFO-consume `quantity` units of `productId` from warehouse StockEntry lots.
   * Decrements StockEntry.remainingQuantity. Does NOT create StockLotAllocation rows
   * (caller must, with consumerType + consumerId).
   * Throws InsufficientStockException if total available < quantity.
   */
  async allocateFromWarehouse(
    tx: Tx,
    productId: string,
    quantity: number,
    opts: AllocateOpts = {},
  ): Promise<WarehouseSlice[]> {
    if (quantity <= 0) return [];
    const today = dhakaTodayDateOnly();
    const lots = await tx.stockEntry.findMany({
      where: {
        productId,
        deletedAt: null,
        remainingQuantity: { gt: 0 },
        ...(opts.includeExpired ? {} : nonExpiredFilter(today)),
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      select: { id: true, remainingQuantity: true, buyingRate: true },
    });

    const slices: WarehouseSlice[] = [];
    let needed = quantity;
    for (const lot of lots) {
      if (needed <= 0) break;
      const take = Math.min(lot.remainingQuantity, needed);
      slices.push({ stockEntryId: lot.id, quantity: take, unitCost: lot.buyingRate });
      needed -= take;
    }
    if (needed > 0) throw new InsufficientStockException([productId]);

    await Promise.all(
      slices.map((s) =>
        tx.stockEntry.update({
          where: { id: s.stockEntryId },
          data: { remainingQuantity: { decrement: s.quantity } },
        }),
      ),
    );
    return slices;
  }

  /**
   * FIFO-consume `quantity` units of `productId` from van lots — i.e., active
   * DISTRIBUTION_LINE StockLotAllocation rows whose underlying DistributionLine
   * belongs to this van and product. Ordered by the underlying StockEntry.date.
   * Decrements the parent allocation's remainingQuantity. Caller creates child
   * StockLotAllocation rows with parentAllocationId set.
   */
  async allocateFromVan(
    tx: Tx,
    vanId: string,
    productId: string,
    quantity: number,
    opts: AllocateOpts = {},
  ): Promise<VanSlice[]> {
    if (quantity <= 0) return [];
    const today = dhakaTodayDateOnly();
    const parents = await tx.stockLotAllocation.findMany({
      where: {
        consumerType: StockLotConsumerType.DISTRIBUTION_LINE,
        remainingQuantity: { gt: 0 },
        stockEntry: {
          productId,
          ...(opts.includeExpired ? {} : nonExpiredFilter(today)),
        },
      },
      include: { stockEntry: { select: { date: true, productId: true } } },
      orderBy: [{ stockEntry: { date: 'asc' } }, { createdAt: 'asc' }],
    });

    const lineIds = Array.from(new Set(parents.map((p) => p.consumerId)));
    const vanLines = await tx.distributionLine.findMany({
      where: { id: { in: lineIds }, distribution: { vanId, deletedAt: null } },
      select: { id: true },
    });
    const vanLineIds = new Set(vanLines.map((l) => l.id));

    const slices: VanSlice[] = [];
    let needed = quantity;
    for (const p of parents) {
      if (needed <= 0) break;
      if (!vanLineIds.has(p.consumerId)) continue;
      const take = Math.min(p.remainingQuantity, needed);
      slices.push({
        parentAllocationId: p.id,
        stockEntryId: p.stockEntryId,
        quantity: take,
        unitCost: p.unitCost,
      });
      needed -= take;
    }
    if (needed > 0) throw new InsufficientStockException([productId]);

    await Promise.all(
      slices.map((s) =>
        tx.stockLotAllocation.update({
          where: { id: s.parentAllocationId },
          data: { remainingQuantity: { decrement: s.quantity } },
        }),
      ),
    );
    return slices;
  }

  /**
   * Reverse allocations created for a given consumer (on delete / return).
   * - DISTRIBUTION_LINE rows: their remainingQuantity (what's still in van) is
   *   returned to the source StockEntry.remainingQuantity; row is deleted.
   * - SALE_ITEM / STOCK_ADJUSTMENT rows: increment parent's remainingQuantity
   *   (back to van); if no parent, increment StockEntry.remainingQuantity. Row
   *   is deleted.
   */
  async reverseAllocationsFor(
    tx: Tx,
    consumerType: StockLotConsumerType,
    consumerId: string,
  ): Promise<void> {
    const rows = await tx.stockLotAllocation.findMany({
      where: { consumerType, consumerId },
    });
    await Promise.all(
      rows.map(async (r) => {
        if (r.consumerType === StockLotConsumerType.DISTRIBUTION_LINE) {
          if (r.remainingQuantity > 0) {
            await tx.stockEntry.update({
              where: { id: r.stockEntryId },
              data: { remainingQuantity: { increment: r.remainingQuantity } },
            });
          }
        } else if (r.parentAllocationId) {
          await tx.stockLotAllocation.update({
            where: { id: r.parentAllocationId },
            data: { remainingQuantity: { increment: r.quantity } },
          });
        } else {
          await tx.stockEntry.update({
            where: { id: r.stockEntryId },
            data: { remainingQuantity: { increment: r.quantity } },
          });
        }
        await tx.stockLotAllocation.delete({ where: { id: r.id } });
      }),
    );
  }

  /**
   * Recompute Product.stock as the warehouse-only invariant:
   *   Product.stock = Σ StockEntry.remainingQuantity (not soft-deleted, non-expired)
   *
   * This represents what's currently available to allocate from the warehouse.
   * Units already dispatched to a van are tracked separately on
   * StockLotAllocation rows (consumerType=DISTRIBUTION_LINE) and are NOT
   * counted here, so dispatching to a van visibly decrements Product.stock.
   *
   * Must be called inside the same transaction as the lot mutation.
   */
  async recomputeProductStock(tx: Tx, productId: string): Promise<void> {
    const today = dhakaTodayDateOnly();
    const warehouse = await tx.stockEntry.aggregate({
      where: { productId, deletedAt: null, ...nonExpiredFilter(today) },
      _sum: { remainingQuantity: true },
    });
    const total = warehouse._sum.remainingQuantity ?? 0;
    await tx.product.update({ where: { id: productId }, data: { stock: total } });
  }

  /**
   * Partial return of a van lot back to warehouse. Used by distribution-line
   * "returned" delta when less than full line is returned. FIFO-LIFO doesn't
   * matter because all allocations share the same (distLine, product); we
   * return from highest-remaining first to keep history concentrated.
   */
  async returnVanLotsToWarehouse(
    tx: Tx,
    distributionLineId: string,
    quantity: number,
  ): Promise<void> {
    if (quantity <= 0) return;
    const allocs = await tx.stockLotAllocation.findMany({
      where: {
        consumerType: StockLotConsumerType.DISTRIBUTION_LINE,
        consumerId: distributionLineId,
        remainingQuantity: { gt: 0 },
      },
      orderBy: { remainingQuantity: 'desc' },
    });
    const decisions: { id: string; stockEntryId: string; take: number }[] = [];
    let needed = quantity;
    for (const a of allocs) {
      if (needed <= 0) break;
      const take = Math.min(a.remainingQuantity, needed);
      decisions.push({ id: a.id, stockEntryId: a.stockEntryId, take });
      needed -= take;
    }
    if (needed > 0) {
      throw new InsufficientStockException(
        [],
        `Cannot return ${quantity} units from distribution line ${distributionLineId}: only ${quantity - needed} available in van lots`,
      );
    }
    await Promise.all(
      decisions.flatMap((d) => [
        tx.stockLotAllocation.update({
          where: { id: d.id },
          data: { remainingQuantity: { decrement: d.take } },
        }),
        tx.stockEntry.update({
          where: { id: d.stockEntryId },
          data: { remainingQuantity: { increment: d.take } },
        }),
      ]),
    );
  }
}
