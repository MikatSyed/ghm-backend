import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockLotConsumerType } from '@prisma/client';
import { listResponse, ListResponse } from '../../common/dto/pagination.dto';
import { parseDhakaDateOnly } from '../../common/util/dhaka-time';
import { PrismaService } from '../../prisma/prisma.service';
import { ListBatchProfitabilityQueryDto } from './dto/list-batch-profitability.query';

type BatchEntry = {
  id: string;
  productId: string;
  quantity: number;
  remainingQuantity: number;
  basePrice: number;
  tradePrice: number | null;
};

type BatchWithEntries = { id: string; date: Date; source: string; entries: BatchEntry[] };

interface ProductBreakdown {
  productId: string;
  productName: string;
  receivedQty: number;
  cost: number;
  soldQty: number;
  soldRevenue: number;
  realizedCogs: number;
  remainingQty: number;
  potentialRevenue: number;
}

export interface BatchProfitSummary {
  batchId: string;
  date: Date;
  source: string;
  // total units ever received into this batch
  totalReceivedQty: number;
  // capital invested (Σ quantity * basePrice)
  totalCost: number;
  // realized (already sold)
  soldQty: number;
  soldRevenue: number;
  realizedCogs: number;
  realizedProfit: number;
  // still unsold, warehouse + van (live/current, not historical)
  remainingQty: number;
  // written off directly from the warehouse via StockAdjustment
  warehouseWriteOffQty: number;
  warehouseWriteOffCost: number;
  // derived residual: received - remaining - sold - warehouseWriteOff (mostly van damage,
  // which doesn't leave its own ledger row — see StockLotService/distributions notes).
  // Valued at the batch's average unit cost since the exact lot is not separately known.
  vanLossQty: number;
  vanLossCost: number;
  totalLossCost: number;
  // if all remaining stock also sold, at current trade price
  potentialRevenueIfSold: number;
  potentialCostOfRemaining: number;
  potentialProfitIfSold: number;
  // realizedProfit - totalLossCost + potentialProfitIfSold
  projectedProfitIfAllSold: number;
  products: ProductBreakdown[];
}

@Injectable()
export class BatchProfitabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async listBatches(q: ListBatchProfitabilityQueryDto): Promise<ListResponse<BatchProfitSummary>> {
    const ands: Prisma.StockBatchWhereInput[] = [{ deletedAt: null }];
    if (q.dateFrom || q.dateTo) {
      ands.push({
        date: {
          ...(q.dateFrom ? { gte: parseDhakaDateOnly(q.dateFrom) } : {}),
          ...(q.dateTo ? { lte: parseDhakaDateOnly(q.dateTo) } : {}),
        },
      });
    }
    if (q.productId) {
      ands.push({ entries: { some: { productId: q.productId, deletedAt: null } } });
    }
    const where: Prisma.StockBatchWhereInput = { AND: ands };

    const [batches, total] = await Promise.all([
      this.prisma.stockBatch.findMany({
        where,
        orderBy: q.parseSort(['date', 'createdAt']) ?? { date: 'desc' },
        skip: q.skip,
        take: q.take,
        include: {
          entries: {
            where: { deletedAt: null, ...(q.productId ? { productId: q.productId } : {}) },
            select: {
              id: true,
              productId: true,
              quantity: true,
              remainingQuantity: true,
              basePrice: true,
              tradePrice: true,
            },
          },
        },
      }),
      this.prisma.stockBatch.count({ where }),
    ]);

    const summaries = await this.computeSummaries(batches);
    return listResponse(summaries, total, q);
  }

  async getBatch(batchId: string): Promise<BatchProfitSummary> {
    const batch = await this.prisma.stockBatch.findFirst({
      where: { id: batchId, deletedAt: null },
      include: {
        entries: {
          where: { deletedAt: null },
          select: {
            id: true,
            productId: true,
            quantity: true,
            remainingQuantity: true,
            basePrice: true,
            tradePrice: true,
          },
        },
      },
    });
    if (!batch) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Batch ${batchId} not found` });
    }
    const [summary] = await this.computeSummaries([batch]);
    return summary;
  }

  private async computeSummaries(batches: BatchWithEntries[]): Promise<BatchProfitSummary[]> {
    const allEntries = batches.flatMap((b) => b.entries);
    const entryIds = allEntries.map((e) => e.id);
    if (entryIds.length === 0) {
      return batches.map((b) => this.emptySummary(b));
    }

    const productIds = Array.from(new Set(allEntries.map((e) => e.productId)));

    const [saleAllocs, vanAllocs, writeOffAllocs, products] = await Promise.all([
      this.prisma.stockLotAllocation.findMany({
        where: { consumerType: StockLotConsumerType.SALE_ITEM, stockEntryId: { in: entryIds } },
        select: { stockEntryId: true, consumerId: true, quantity: true, unitCost: true },
      }),
      this.prisma.stockLotAllocation.findMany({
        where: {
          consumerType: StockLotConsumerType.DISTRIBUTION_LINE,
          stockEntryId: { in: entryIds },
          remainingQuantity: { gt: 0 },
        },
        select: { stockEntryId: true, remainingQuantity: true },
      }),
      this.prisma.stockLotAllocation.findMany({
        where: {
          consumerType: StockLotConsumerType.STOCK_ADJUSTMENT,
          stockEntryId: { in: entryIds },
        },
        select: { stockEntryId: true, quantity: true, unitCost: true },
      }),
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, tradePrice: true },
      }),
    ]);

    const saleItemIds = Array.from(new Set(saleAllocs.map((a) => a.consumerId)));
    const saleItems = saleItemIds.length
      ? await this.prisma.saleItem.findMany({
          where: { id: { in: saleItemIds } },
          select: { id: true, price: true },
        })
      : [];
    const saleItemPriceById = new Map(saleItems.map((si) => [si.id, si.price]));
    const productById = new Map(products.map((p) => [p.id, p]));

    const salesByEntry = new Map<string, typeof saleAllocs>();
    for (const a of saleAllocs) {
      const arr = salesByEntry.get(a.stockEntryId) ?? [];
      arr.push(a);
      salesByEntry.set(a.stockEntryId, arr);
    }
    const vanRemainingByEntry = new Map<string, number>();
    for (const a of vanAllocs) {
      vanRemainingByEntry.set(
        a.stockEntryId,
        (vanRemainingByEntry.get(a.stockEntryId) ?? 0) + a.remainingQuantity,
      );
    }
    const writeOffByEntry = new Map<string, typeof writeOffAllocs>();
    for (const a of writeOffAllocs) {
      const arr = writeOffByEntry.get(a.stockEntryId) ?? [];
      arr.push(a);
      writeOffByEntry.set(a.stockEntryId, arr);
    }

    return batches.map((batch) =>
      this.summarizeBatch(batch, {
        salesByEntry,
        vanRemainingByEntry,
        writeOffByEntry,
        saleItemPriceById,
        productById,
      }),
    );
  }

  private summarizeBatch(
    batch: BatchWithEntries,
    idx: {
      salesByEntry: Map<
        string,
        { stockEntryId: string; consumerId: string; quantity: number; unitCost: number }[]
      >;
      vanRemainingByEntry: Map<string, number>;
      writeOffByEntry: Map<string, { stockEntryId: string; quantity: number; unitCost: number }[]>;
      saleItemPriceById: Map<string, number>;
      productById: Map<string, { id: string; name: string; tradePrice: number }>;
    },
  ): BatchProfitSummary {
    const productMap = new Map<string, ProductBreakdown>();

    let totalReceivedQty = 0;
    let totalCost = 0;
    let soldQty = 0;
    let soldRevenue = 0;
    let realizedCogs = 0;
    let remainingQty = 0;
    let warehouseWriteOffQty = 0;
    let warehouseWriteOffCost = 0;
    let potentialRevenueIfSold = 0;
    let potentialCostOfRemaining = 0;

    for (const entry of batch.entries) {
      const product = idx.productById.get(entry.productId);
      const sellPrice = entry.tradePrice ?? product?.tradePrice ?? 0;

      const pb = productMap.get(entry.productId) ?? {
        productId: entry.productId,
        productName: product?.name ?? entry.productId,
        receivedQty: 0,
        cost: 0,
        soldQty: 0,
        soldRevenue: 0,
        realizedCogs: 0,
        remainingQty: 0,
        potentialRevenue: 0,
      };

      const entryCost = entry.quantity * entry.basePrice;
      totalReceivedQty += entry.quantity;
      totalCost += entryCost;
      pb.receivedQty += entry.quantity;
      pb.cost += entryCost;

      const sales = idx.salesByEntry.get(entry.id) ?? [];
      let entrySoldQty = 0;
      let entrySoldRevenue = 0;
      let entryCogs = 0;
      for (const s of sales) {
        const price = idx.saleItemPriceById.get(s.consumerId) ?? 0;
        entrySoldQty += s.quantity;
        entrySoldRevenue += s.quantity * price;
        entryCogs += s.quantity * s.unitCost;
      }
      soldQty += entrySoldQty;
      soldRevenue += entrySoldRevenue;
      realizedCogs += entryCogs;
      pb.soldQty += entrySoldQty;
      pb.soldRevenue += entrySoldRevenue;
      pb.realizedCogs += entryCogs;

      const entryRemaining = entry.remainingQuantity + (idx.vanRemainingByEntry.get(entry.id) ?? 0);
      remainingQty += entryRemaining;
      pb.remainingQty += entryRemaining;
      const entryPotentialRevenue = entryRemaining * sellPrice;
      potentialRevenueIfSold += entryPotentialRevenue;
      potentialCostOfRemaining += entryRemaining * entry.basePrice;
      pb.potentialRevenue += entryPotentialRevenue;

      const writeOffs = idx.writeOffByEntry.get(entry.id) ?? [];
      for (const w of writeOffs) {
        warehouseWriteOffQty += w.quantity;
        warehouseWriteOffCost += w.quantity * w.unitCost;
      }

      productMap.set(entry.productId, pb);
    }

    const vanLossQty = Math.max(
      0,
      totalReceivedQty - remainingQty - soldQty - warehouseWriteOffQty,
    );
    const avgUnitCost = totalReceivedQty > 0 ? totalCost / totalReceivedQty : 0;
    const vanLossCost = Math.round(vanLossQty * avgUnitCost);
    const totalLossCost = warehouseWriteOffCost + vanLossCost;
    const realizedProfit = soldRevenue - realizedCogs;
    const potentialProfitIfSold = potentialRevenueIfSold - potentialCostOfRemaining;
    const projectedProfitIfAllSold = realizedProfit - totalLossCost + potentialProfitIfSold;

    return {
      batchId: batch.id,
      date: batch.date,
      source: batch.source,
      totalReceivedQty,
      totalCost,
      soldQty,
      soldRevenue,
      realizedCogs,
      realizedProfit,
      remainingQty,
      warehouseWriteOffQty,
      warehouseWriteOffCost,
      vanLossQty,
      vanLossCost,
      totalLossCost,
      potentialRevenueIfSold,
      potentialCostOfRemaining,
      potentialProfitIfSold,
      projectedProfitIfAllSold,
      products: Array.from(productMap.values()),
    };
  }

  private emptySummary(batch: { id: string; date: Date; source: string }): BatchProfitSummary {
    return {
      batchId: batch.id,
      date: batch.date,
      source: batch.source,
      totalReceivedQty: 0,
      totalCost: 0,
      soldQty: 0,
      soldRevenue: 0,
      realizedCogs: 0,
      realizedProfit: 0,
      remainingQty: 0,
      warehouseWriteOffQty: 0,
      warehouseWriteOffCost: 0,
      vanLossQty: 0,
      vanLossCost: 0,
      totalLossCost: 0,
      potentialRevenueIfSold: 0,
      potentialCostOfRemaining: 0,
      potentialProfitIfSold: 0,
      projectedProfitIfAllSold: 0,
      products: [],
    };
  }
}
