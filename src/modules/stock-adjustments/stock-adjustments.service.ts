import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  Prisma,
  StockLocation,
  StockLotConsumerType,
  TransactionType,
} from '@prisma/client';
import { listResponse, ListResponse } from '../../common/dto/pagination.dto';
import { PrefixIdService } from '../../common/services/prefix-id.service';
import { StockLotService } from '../../common/services/stock-lot.service';
import { parseDhakaDateOnly } from '../../common/util/dhaka-time';
import { PrismaService } from '../../prisma/prisma.service';
import { ByLotQueryDto } from './dto/by-lot.query';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { ListStockAdjustmentsQueryDto } from './dto/list-stock-adjustments.query';

@Injectable()
export class StockAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: PrefixIdService,
    private readonly lots: StockLotService,
  ) {}

  async create(dto: CreateStockAdjustmentDto) {
    const date = parseDhakaDateOnly(dto.date);

    if (dto.location === StockLocation.VAN && !dto.vanId) {
      throw new BadRequestException({
        code: 'VAN_REQUIRED',
        message: 'vanId is required when location is VAN',
        fields: { vanId: 'required' },
      });
    }
    if (dto.location === StockLocation.WAREHOUSE && dto.vanId) {
      throw new BadRequestException({
        code: 'VAN_NOT_ALLOWED',
        message: 'vanId must be omitted when location is WAREHOUSE',
        fields: { vanId: 'not_allowed' },
      });
    }
    if (dto.stockEntryId && dto.location !== StockLocation.WAREHOUSE) {
      throw new BadRequestException({
        code: 'STOCK_ENTRY_WAREHOUSE_ONLY',
        message: 'stockEntryId targeting is only supported when location is WAREHOUSE',
        fields: { stockEntryId: 'not_allowed' },
      });
    }

    return this.prisma.$transaction(
      async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: dto.productId, deletedAt: null },
      });
      if (!product) {
        throw new BadRequestException({
          code: 'INVALID_PRODUCT',
          message: `Product ${dto.productId} not found`,
          fields: { productId: 'unknown' },
        });
      }

      if (dto.vanId) {
        const van = await tx.van.findFirst({ where: { id: dto.vanId, deletedAt: null } });
        if (!van) {
          throw new BadRequestException({
            code: 'INVALID_VAN',
            message: `Van ${dto.vanId} not found`,
            fields: { vanId: 'unknown' },
          });
        }
      }

      const id = await this.ids.next('ADJ', 3, tx);
      const adjustment = await tx.stockAdjustment.create({
        data: {
          id,
          date,
          productId: dto.productId,
          quantity: dto.quantity,
          reason: dto.reason,
          location: dto.location,
          vanId: dto.vanId,
          notes: dto.notes,
        },
      });

      // Adjustments (DAMAGE/WASTAGE/CORRECTION) must be able to write off
      // expired stock, so allow consuming expired lots here.
      let allocationRows: Array<{
        stockEntryId: string;
        parentAllocationId?: string;
        consumerType: StockLotConsumerType;
        consumerId: string;
        quantity: number;
        unitCost: number;
      }>;

      if (dto.stockEntryId) {
        // Targeted single-lot path: validate the lot belongs to this product.
        const lot = await tx.stockEntry.findFirst({
          where: { id: dto.stockEntryId, productId: dto.productId, deletedAt: null },
          select: { id: true, remainingQuantity: true, buyingRate: true },
        });
        if (!lot) {
          throw new BadRequestException({
            code: 'INVALID_STOCK_ENTRY',
            message: `Stock entry ${dto.stockEntryId} not found for product ${dto.productId}`,
            fields: { stockEntryId: 'unknown' },
          });
        }
        if (lot.remainingQuantity < dto.quantity) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_STOCK',
            message: `Stock entry ${dto.stockEntryId} has only ${lot.remainingQuantity} remaining, requested ${dto.quantity}`,
            fields: { quantity: 'exceeds_remaining' },
          });
        }
        await tx.stockEntry.update({
          where: { id: dto.stockEntryId },
          data: { remainingQuantity: { decrement: dto.quantity } },
        });
        allocationRows = [
          {
            stockEntryId: lot.id,
            consumerType: StockLotConsumerType.STOCK_ADJUSTMENT,
            consumerId: adjustment.id,
            quantity: dto.quantity,
            unitCost: lot.buyingRate,
          },
        ];
      } else if (dto.location === StockLocation.WAREHOUSE) {
        const slices = await this.lots.allocateFromWarehouse(
          tx,
          dto.productId,
          dto.quantity,
          { includeExpired: true },
        );
        allocationRows = slices.map((s) => ({
          stockEntryId: s.stockEntryId,
          consumerType: StockLotConsumerType.STOCK_ADJUSTMENT,
          consumerId: adjustment.id,
          quantity: s.quantity,
          unitCost: s.unitCost,
        }));
      } else {
        const slices = await this.lots.allocateFromVan(
          tx,
          dto.vanId!,
          dto.productId,
          dto.quantity,
          { includeExpired: true },
        );
        allocationRows = slices.map((s) => ({
          stockEntryId: s.stockEntryId,
          parentAllocationId: s.parentAllocationId,
          consumerType: StockLotConsumerType.STOCK_ADJUSTMENT,
          consumerId: adjustment.id,
          quantity: s.quantity,
          unitCost: s.unitCost,
        }));
      }

      if (allocationRows.length > 0) {
        await tx.stockLotAllocation.createMany({ data: allocationRows });
      }
      const costAmount = allocationRows.reduce((sum, r) => sum + r.quantity * r.unitCost, 0);

      await this.lots.recomputeProductStock(tx, dto.productId);

      await tx.transaction.create({
        data: {
          occurredAt: new Date(),
          amount: costAmount,
          type: TransactionType.stock,
          description: `Adjustment (${dto.reason.toLowerCase()} @ ${dto.location.toLowerCase()}): ${product.name} −${dto.quantity} ${product.unit}`,
          refTable: 'stock_adjustments',
          refId: adjustment.id,
        },
      });

      await tx.auditLog.create({
        data: {
          action: AuditAction.CREATE,
          entity: 'StockAdjustment',
          entityId: adjustment.id,
          after: adjustment as unknown as Prisma.InputJsonValue,
          meta: {
            allocations: allocationRows.map((r) => ({
              stockEntryId: r.stockEntryId,
              quantity: r.quantity,
              unitCost: r.unitCost,
            })),
            costAmount,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      const touchedEntryIds = Array.from(new Set(allocationRows.map((r) => r.stockEntryId)));
      const [touchedEntries, updatedProduct] = await Promise.all([
        touchedEntryIds.length
          ? tx.stockEntry.findMany({
              where: { id: { in: touchedEntryIds } },
              select: { id: true, remainingQuantity: true, expiryDate: true },
            })
          : Promise.resolve([]),
        tx.product.findUnique({
          where: { id: dto.productId },
          select: { stock: true },
        }),
      ]);
      const entryMap = new Map(touchedEntries.map((e) => [e.id, e]));

      return {
        ...adjustment,
        productStock: updatedProduct?.stock ?? 0,
        lots: allocationRows.map((r) => {
          const entry = entryMap.get(r.stockEntryId);
          return {
            stockEntryId: r.stockEntryId,
            quantity: r.quantity,
            unitCost: r.unitCost,
            remainingQuantity: entry?.remainingQuantity ?? null,
            expiryDate: entry?.expiryDate ?? null,
          };
        }),
      };
    },
      { timeout: 20000, maxWait: 5000 },
    );
  }

  async findAll(q: ListStockAdjustmentsQueryDto): Promise<ListResponse<unknown>> {
    const where: Prisma.StockAdjustmentWhereInput = {
      deletedAt: null,
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.vanId ? { vanId: q.vanId } : {}),
      ...(q.reason ? { reason: q.reason } : {}),
      ...(q.location ? { location: q.location } : {}),
      ...(q.dateFrom || q.dateTo
        ? {
            date: {
              ...(q.dateFrom ? { gte: parseDhakaDateOnly(q.dateFrom) } : {}),
              ...(q.dateTo ? { lte: parseDhakaDateOnly(q.dateTo) } : {}),
            },
          }
        : {}),
      ...(q.q
        ? {
            OR: [
              { id: { contains: q.q.toUpperCase() } },
              { notes: { contains: q.q, mode: 'insensitive' } },
              { product: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const orderBy = q.parseSort(['date', 'createdAt', 'quantity']) ?? { date: 'desc' };
    const [items, total] = await Promise.all([
      this.prisma.stockAdjustment.findMany({
        where,
        orderBy,
        skip: q.skip,
        take: q.take,
        include: {
          product: { select: { name: true, unit: true } },
          van: { select: { vanName: true } },
        },
      }),
      this.prisma.stockAdjustment.count({ where }),
    ]);
    return listResponse(items, total, q);
  }

  async byLot(q: ByLotQueryDto) {
    const dateFilter =
      q.dateFrom || q.dateTo
        ? {
            date: {
              ...(q.dateFrom ? { gte: parseDhakaDateOnly(q.dateFrom) } : {}),
              ...(q.dateTo ? { lte: parseDhakaDateOnly(q.dateTo) } : {}),
            },
          }
        : {};

    const allocs = await this.prisma.stockLotAllocation.findMany({
      where: {
        consumerType: StockLotConsumerType.STOCK_ADJUSTMENT,
        ...(q.stockEntryId ? { stockEntryId: q.stockEntryId } : {}),
        ...(q.productId ? { stockEntry: { productId: q.productId } } : {}),
      },
      include: {
        stockEntry: {
          select: {
            id: true,
            date: true,
            expiryDate: true,
            quantity: true,
            remainingQuantity: true,
            buyingRate: true,
            source: true,
            productId: true,
            product: { select: { id: true, name: true, unit: true } },
          },
        },
      },
    });
    if (allocs.length === 0) return [];

    const adjIds = Array.from(new Set(allocs.map((a) => a.consumerId)));
    const adjustments = await this.prisma.stockAdjustment.findMany({
      where: { id: { in: adjIds }, deletedAt: null, ...dateFilter },
      select: {
        id: true,
        date: true,
        reason: true,
        location: true,
        vanId: true,
        notes: true,
        createdAt: true,
      },
    });
    const adjMap = new Map(adjustments.map((a) => [a.id, a]));

    type LotBucket = {
      stockEntryId: string;
      product: { id: string; name: string; unit: string };
      stockEntry: {
        date: Date;
        expiryDate: Date | null;
        originalQuantity: number;
        remainingQuantity: number;
        buyingRate: number;
        source: string;
      };
      totalAdjusted: number;
      byReason: Record<string, number>;
      adjustments: Array<{
        id: string;
        date: Date;
        quantity: number;
        reason: string;
        location: string;
        vanId: string | null;
        notes: string | null;
      }>;
    };

    const byLot = new Map<string, LotBucket>();
    for (const a of allocs) {
      const adj = adjMap.get(a.consumerId);
      if (!adj) continue; // adjustment was soft-deleted or filtered out by date
      let bucket = byLot.get(a.stockEntryId);
      if (!bucket) {
        bucket = {
          stockEntryId: a.stockEntryId,
          product: a.stockEntry.product,
          stockEntry: {
            date: a.stockEntry.date,
            expiryDate: a.stockEntry.expiryDate,
            originalQuantity: a.stockEntry.quantity,
            remainingQuantity: a.stockEntry.remainingQuantity,
            buyingRate: a.stockEntry.buyingRate,
            source: a.stockEntry.source,
          },
          totalAdjusted: 0,
          byReason: {},
          adjustments: [],
        };
        byLot.set(a.stockEntryId, bucket);
      }
      bucket.totalAdjusted += a.quantity;
      bucket.byReason[adj.reason] = (bucket.byReason[adj.reason] ?? 0) + a.quantity;
      bucket.adjustments.push({
        id: adj.id,
        date: adj.date,
        quantity: a.quantity,
        reason: adj.reason,
        location: adj.location,
        vanId: adj.vanId,
        notes: adj.notes,
      });
    }
    // sort adjustments newest-first per lot, lots by stockEntryId
    for (const bucket of byLot.values()) {
      bucket.adjustments.sort((a, b) => b.date.getTime() - a.date.getTime());
    }
    return Array.from(byLot.values()).sort((a, b) =>
      a.stockEntryId < b.stockEntryId ? -1 : 1,
    );
  }

  async findOne(id: string) {
    const a = await this.prisma.stockAdjustment.findFirst({
      where: { id, deletedAt: null },
      include: { product: true, van: true },
    });
    if (!a) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Stock adjustment ${id} not found`,
      });
    }
    const allocations = await this.prisma.stockLotAllocation.findMany({
      where: { consumerType: StockLotConsumerType.STOCK_ADJUSTMENT, consumerId: id },
      include: { stockEntry: { select: { id: true, source: true, buyingRate: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { ...a, lots: allocations };
  }

  async remove(id: string) {
    return this.prisma.$transaction(
      async (tx) => {
      const a = await tx.stockAdjustment.findFirst({ where: { id, deletedAt: null } });
      if (!a) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: `Stock adjustment ${id} not found`,
        });
      }
      await this.lots.reverseAllocationsFor(tx, StockLotConsumerType.STOCK_ADJUSTMENT, id);
      await tx.stockAdjustment.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.lots.recomputeProductStock(tx, a.productId);
      await tx.auditLog.create({
        data: {
          action: AuditAction.DELETE,
          entity: 'StockAdjustment',
          entityId: id,
          before: a as unknown as Prisma.InputJsonValue,
        },
      });
      return { id, deleted: true };
    },
      { timeout: 20000, maxWait: 5000 },
    );
  }

  async history(id: string) {
    const adjustment = await this.prisma.stockAdjustment.findUnique({
      where: { id },
      include: {
        product: { select: { name: true, unit: true } },
        van: { select: { vanName: true } },
      },
    });
    if (!adjustment) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Stock adjustment ${id} not found`,
      });
    }
    const [audit, transactions, allocations] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { entity: 'StockAdjustment', entityId: id },
        orderBy: { occurredAt: 'desc' },
        take: 200,
      }),
      this.prisma.transaction.findMany({
        where: { refTable: 'stock_adjustments', refId: id },
        orderBy: { occurredAt: 'desc' },
        take: 100,
      }),
      this.prisma.stockLotAllocation.findMany({
        where: {
          consumerType: StockLotConsumerType.STOCK_ADJUSTMENT,
          consumerId: id,
        },
        orderBy: { createdAt: 'asc' },
        include: {
          stockEntry: {
            select: {
              id: true,
              date: true,
              source: true,
              expiryDate: true,
              buyingRate: true,
            },
          },
        },
      }),
    ]);
    return { adjustment, audit, transactions, allocations };
  }

  async auditAll(q: { page: number; pageSize: number; skip: number; take: number }) {
    const where = { entity: 'StockAdjustment' as const };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: q.skip,
        take: q.take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data: items, page: q.page, pageSize: q.pageSize, total };
  }
}
