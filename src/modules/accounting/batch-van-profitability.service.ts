import { BadRequestException, Injectable } from '@nestjs/common';
import { dhakaDateString, monthBoundsUtc } from '../../common/util/dhaka-time';
import { PrismaService } from '../../prisma/prisma.service';
import { ListBatchVanProfitabilityQueryDto } from './dto/list-batch-van-profitability.query';

type NumericLike = number | bigint | null;

interface BatchVanProfitabilityDbRow {
  batchId: string;
  date: Date;
  source: string;
  vanId: string;
  vanName: string;
  assignedQty: NumericLike;
  assignedCost: NumericLike;
  soldQty: NumericLike;
  soldRevenue: NumericLike;
  soldCogs: NumericLike;
  grossProfit: NumericLike;
  lossQty: NumericLike;
  lossCost: NumericLike;
  remainingQty: NumericLike;
}

interface BatchVanProfitabilityTotalsDbRow {
  assignedQty: NumericLike;
  assignedCost: NumericLike;
  soldQty: NumericLike;
  totalSell: NumericLike;
  totalCost: NumericLike;
  grossProfit: NumericLike;
  lossQty: NumericLike;
  lossCost: NumericLike;
  batchCount: NumericLike;
}

interface CountDbRow {
  total: NumericLike;
}

export interface BatchVanProfitabilityRow {
  batchId: string;
  date: Date;
  source: string;
  vanId: string;
  vanName: string;
  assignedQty: number;
  assignedCost: number;
  soldQty: number;
  soldRevenue: number;
  soldCogs: number;
  grossProfit: number;
  profitMargin: number;
  lossQty: number;
  lossCost: number;
  remainingQty: number;
}

export interface BatchVanProfitabilityTotals {
  totalSell: number;
  totalCost: number;
  grossProfit: number;
  profitMargin: number;
  assignedQty: number;
  assignedCost: number;
  soldQty: number;
  lossQty: number;
  lossCost: number;
  batchCount: number;
}

export interface BatchVanProfitabilityResponse {
  data: BatchVanProfitabilityRow[];
  page: number;
  pageSize: number;
  total: number;
  totals: BatchVanProfitabilityTotals;
}

@Injectable()
export class BatchVanProfitabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListBatchVanProfitabilityQueryDto): Promise<BatchVanProfitabilityResponse> {
    const month = q.month ?? dhakaDateString().slice(0, 7);
    this.assertMonth(month);
    const { startUtc, endUtc, startDateOnly, endDateOnly } = monthBoundsUtc(month);
    const vanId = q.vanId ?? null;
    const batchId = q.batchId ?? null;
    const productId = q.productId ?? null;
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [totalsRows, countRows, rows] = await Promise.all([
      this.totalsQuery(startUtc, endUtc, startDateOnly, endDateOnly, vanId, batchId, productId),
      this.countQuery(startUtc, endUtc, startDateOnly, endDateOnly, vanId, batchId, productId),
      this.rowsQuery(
        startUtc,
        endUtc,
        startDateOnly,
        endDateOnly,
        vanId,
        batchId,
        productId,
        skip,
        pageSize,
      ),
    ]);

    const totals = this.mapTotals(totalsRows[0]);
    return {
      data: rows.map((row) => this.mapRow(row)),
      page,
      pageSize,
      total: this.num(countRows[0]?.total),
      totals,
    };
  }

  private totalsQuery(
    startUtc: Date,
    endUtc: Date,
    startDateOnly: Date,
    endDateOnly: Date,
    vanId: string | null,
    batchId: string | null,
    productId: string | null,
  ) {
    return this.prisma.$queryRaw<BatchVanProfitabilityTotalsDbRow[]>`
      WITH sale_rows AS (
        SELECT se."batchId", s."vanId", a.quantity, a."unitCost", si.price
        FROM stock_lot_allocations a
        JOIN stock_entries se ON se.id = a."stockEntryId"
        JOIN sale_items si ON si.id = a."consumerId" AND a."consumerType" = 'SALE_ITEM'::"StockLotConsumerType"
        JOIN sales s ON s.id = si."saleId"
        JOIN invoices i ON i.id = s."invoiceId"
        WHERE i."deletedAt" IS NULL
          AND se."batchId" IS NOT NULL
          AND i."createdAt" >= ${startUtc}
          AND i."createdAt" < ${endUtc}
          AND (${vanId}::text IS NULL OR s."vanId" = ${vanId})
          AND (${batchId}::text IS NULL OR se."batchId" = ${batchId})
          AND (${productId}::text IS NULL OR se."productId" = ${productId})
      ),
      assign_rows AS (
        SELECT se."batchId", d."vanId", a.quantity, a."unitCost"
        FROM stock_lot_allocations a
        JOIN stock_entries se ON se.id = a."stockEntryId"
        JOIN distribution_lines dl ON dl.id = a."consumerId" AND a."consumerType" = 'DISTRIBUTION_LINE'::"StockLotConsumerType"
        JOIN distributions d ON d.id = dl."distributionId"
        WHERE d."deletedAt" IS NULL
          AND se."batchId" IS NOT NULL
          AND d.date >= ${startDateOnly}
          AND d.date < ${endDateOnly}
          AND (${vanId}::text IS NULL OR d."vanId" = ${vanId})
          AND (${batchId}::text IS NULL OR se."batchId" = ${batchId})
          AND (${productId}::text IS NULL OR se."productId" = ${productId})
      ),
      loss_rows AS (
        SELECT se."batchId", sa."vanId", a.quantity, a."unitCost"
        FROM stock_lot_allocations a
        JOIN stock_entries se ON se.id = a."stockEntryId"
        JOIN stock_adjustments sa ON sa.id = a."consumerId" AND a."consumerType" = 'STOCK_ADJUSTMENT'::"StockLotConsumerType"
        WHERE sa."deletedAt" IS NULL
          AND sa."vanId" IS NOT NULL
          AND se."batchId" IS NOT NULL
          AND sa.date >= ${startDateOnly}
          AND sa.date < ${endDateOnly}
          AND (${vanId}::text IS NULL OR sa."vanId" = ${vanId})
          AND (${batchId}::text IS NULL OR se."batchId" = ${batchId})
          AND (${productId}::text IS NULL OR se."productId" = ${productId})
      ),
      current_rows AS (
        SELECT se."batchId", d."vanId", a."remainingQuantity" AS quantity, a."unitCost"
        FROM stock_lot_allocations a
        JOIN stock_entries se ON se.id = a."stockEntryId"
        JOIN distribution_lines dl ON dl.id = a."consumerId" AND a."consumerType" = 'DISTRIBUTION_LINE'::"StockLotConsumerType"
        JOIN distributions d ON d.id = dl."distributionId"
        WHERE d."deletedAt" IS NULL
          AND se."batchId" IS NOT NULL
          AND a."remainingQuantity" > 0
          AND (${vanId}::text IS NULL OR d."vanId" = ${vanId})
          AND (${batchId}::text IS NULL OR se."batchId" = ${batchId})
          AND (${productId}::text IS NULL OR se."productId" = ${productId})
      ),
      keys AS (
        SELECT "batchId", "vanId" FROM sale_rows WHERE "vanId" IS NOT NULL
        UNION SELECT "batchId", "vanId" FROM assign_rows
        UNION SELECT "batchId", "vanId" FROM loss_rows
        UNION SELECT "batchId", "vanId" FROM current_rows
      )
      SELECT
        COALESCE((SELECT SUM(quantity) FROM assign_rows), 0)::bigint AS "assignedQty",
        COALESCE((SELECT SUM(quantity * "unitCost") FROM assign_rows), 0)::bigint AS "assignedCost",
        COALESCE((SELECT SUM(quantity) FROM sale_rows), 0)::bigint AS "soldQty",
        COALESCE((SELECT SUM(quantity * price) FROM sale_rows), 0)::bigint AS "totalSell",
        COALESCE((SELECT SUM(quantity * "unitCost") FROM sale_rows), 0)::bigint AS "totalCost",
        COALESCE((SELECT SUM(quantity * (price - "unitCost")) FROM sale_rows), 0)::bigint AS "grossProfit",
        COALESCE((SELECT SUM(quantity) FROM loss_rows), 0)::bigint AS "lossQty",
        COALESCE((SELECT SUM(quantity * "unitCost") FROM loss_rows), 0)::bigint AS "lossCost",
        COALESCE((SELECT COUNT(DISTINCT "batchId") FROM keys), 0)::bigint AS "batchCount"
    `;
  }

  private countQuery(
    startUtc: Date,
    endUtc: Date,
    startDateOnly: Date,
    endDateOnly: Date,
    vanId: string | null,
    batchId: string | null,
    productId: string | null,
  ) {
    return this.prisma.$queryRaw<CountDbRow[]>`
      WITH keys AS (
        SELECT se."batchId", s."vanId"
        FROM stock_lot_allocations a
        JOIN stock_entries se ON se.id = a."stockEntryId"
        JOIN sale_items si ON si.id = a."consumerId" AND a."consumerType" = 'SALE_ITEM'::"StockLotConsumerType"
        JOIN sales s ON s.id = si."saleId"
        JOIN invoices i ON i.id = s."invoiceId"
        WHERE i."deletedAt" IS NULL AND se."batchId" IS NOT NULL AND s."vanId" IS NOT NULL
          AND i."createdAt" >= ${startUtc} AND i."createdAt" < ${endUtc}
          AND (${vanId}::text IS NULL OR s."vanId" = ${vanId})
          AND (${batchId}::text IS NULL OR se."batchId" = ${batchId})
          AND (${productId}::text IS NULL OR se."productId" = ${productId})
        UNION
        SELECT se."batchId", d."vanId"
        FROM stock_lot_allocations a
        JOIN stock_entries se ON se.id = a."stockEntryId"
        JOIN distribution_lines dl ON dl.id = a."consumerId" AND a."consumerType" = 'DISTRIBUTION_LINE'::"StockLotConsumerType"
        JOIN distributions d ON d.id = dl."distributionId"
        WHERE d."deletedAt" IS NULL AND se."batchId" IS NOT NULL
          AND d.date >= ${startDateOnly} AND d.date < ${endDateOnly}
          AND (${vanId}::text IS NULL OR d."vanId" = ${vanId})
          AND (${batchId}::text IS NULL OR se."batchId" = ${batchId})
          AND (${productId}::text IS NULL OR se."productId" = ${productId})
        UNION
        SELECT se."batchId", sa."vanId"
        FROM stock_lot_allocations a
        JOIN stock_entries se ON se.id = a."stockEntryId"
        JOIN stock_adjustments sa ON sa.id = a."consumerId" AND a."consumerType" = 'STOCK_ADJUSTMENT'::"StockLotConsumerType"
        WHERE sa."deletedAt" IS NULL AND sa."vanId" IS NOT NULL AND se."batchId" IS NOT NULL
          AND sa.date >= ${startDateOnly} AND sa.date < ${endDateOnly}
          AND (${vanId}::text IS NULL OR sa."vanId" = ${vanId})
          AND (${batchId}::text IS NULL OR se."batchId" = ${batchId})
          AND (${productId}::text IS NULL OR se."productId" = ${productId})
      )
      SELECT COUNT(*)::bigint AS total FROM keys
    `;
  }

  private rowsQuery(
    startUtc: Date,
    endUtc: Date,
    startDateOnly: Date,
    endDateOnly: Date,
    vanId: string | null,
    batchId: string | null,
    productId: string | null,
    skip: number,
    take: number,
  ) {
    return this.prisma.$queryRaw<BatchVanProfitabilityDbRow[]>`
      WITH sale_rows AS (
        SELECT se."batchId", s."vanId", a.quantity, a."unitCost", si.price
        FROM stock_lot_allocations a
        JOIN stock_entries se ON se.id = a."stockEntryId"
        JOIN sale_items si ON si.id = a."consumerId" AND a."consumerType" = 'SALE_ITEM'::"StockLotConsumerType"
        JOIN sales s ON s.id = si."saleId"
        JOIN invoices i ON i.id = s."invoiceId"
        WHERE i."deletedAt" IS NULL AND se."batchId" IS NOT NULL AND s."vanId" IS NOT NULL
          AND i."createdAt" >= ${startUtc} AND i."createdAt" < ${endUtc}
          AND (${vanId}::text IS NULL OR s."vanId" = ${vanId})
          AND (${batchId}::text IS NULL OR se."batchId" = ${batchId})
          AND (${productId}::text IS NULL OR se."productId" = ${productId})
      ),
      assign_rows AS (
        SELECT se."batchId", d."vanId", a.quantity, a."unitCost"
        FROM stock_lot_allocations a
        JOIN stock_entries se ON se.id = a."stockEntryId"
        JOIN distribution_lines dl ON dl.id = a."consumerId" AND a."consumerType" = 'DISTRIBUTION_LINE'::"StockLotConsumerType"
        JOIN distributions d ON d.id = dl."distributionId"
        WHERE d."deletedAt" IS NULL AND se."batchId" IS NOT NULL
          AND d.date >= ${startDateOnly} AND d.date < ${endDateOnly}
          AND (${vanId}::text IS NULL OR d."vanId" = ${vanId})
          AND (${batchId}::text IS NULL OR se."batchId" = ${batchId})
          AND (${productId}::text IS NULL OR se."productId" = ${productId})
      ),
      loss_rows AS (
        SELECT se."batchId", sa."vanId", a.quantity, a."unitCost"
        FROM stock_lot_allocations a
        JOIN stock_entries se ON se.id = a."stockEntryId"
        JOIN stock_adjustments sa ON sa.id = a."consumerId" AND a."consumerType" = 'STOCK_ADJUSTMENT'::"StockLotConsumerType"
        WHERE sa."deletedAt" IS NULL AND sa."vanId" IS NOT NULL AND se."batchId" IS NOT NULL
          AND sa.date >= ${startDateOnly} AND sa.date < ${endDateOnly}
          AND (${vanId}::text IS NULL OR sa."vanId" = ${vanId})
          AND (${batchId}::text IS NULL OR se."batchId" = ${batchId})
          AND (${productId}::text IS NULL OR se."productId" = ${productId})
      ),
      current_rows AS (
        SELECT se."batchId", d."vanId", a."remainingQuantity" AS quantity, a."unitCost"
        FROM stock_lot_allocations a
        JOIN stock_entries se ON se.id = a."stockEntryId"
        JOIN distribution_lines dl ON dl.id = a."consumerId" AND a."consumerType" = 'DISTRIBUTION_LINE'::"StockLotConsumerType"
        JOIN distributions d ON d.id = dl."distributionId"
        WHERE d."deletedAt" IS NULL AND se."batchId" IS NOT NULL AND a."remainingQuantity" > 0
          AND (${vanId}::text IS NULL OR d."vanId" = ${vanId})
          AND (${batchId}::text IS NULL OR se."batchId" = ${batchId})
          AND (${productId}::text IS NULL OR se."productId" = ${productId})
      ),
      keys AS (
        SELECT "batchId", "vanId" FROM sale_rows
        UNION SELECT "batchId", "vanId" FROM assign_rows
        UNION SELECT "batchId", "vanId" FROM loss_rows
        UNION SELECT "batchId", "vanId" FROM current_rows
      )
      SELECT
        k."batchId",
        sb.date,
        sb.source,
        k."vanId",
        v."vanName",
        COALESCE(assign_agg.qty, 0)::bigint AS "assignedQty",
        COALESCE(assign_agg.cost, 0)::bigint AS "assignedCost",
        COALESCE(sale_agg.qty, 0)::bigint AS "soldQty",
        COALESCE(sale_agg.revenue, 0)::bigint AS "soldRevenue",
        COALESCE(sale_agg.cogs, 0)::bigint AS "soldCogs",
        COALESCE(sale_agg.profit, 0)::bigint AS "grossProfit",
        COALESCE(loss_agg.qty, 0)::bigint AS "lossQty",
        COALESCE(loss_agg.cost, 0)::bigint AS "lossCost",
        COALESCE(current_agg.qty, 0)::bigint AS "remainingQty"
      FROM keys k
      JOIN stock_batches sb ON sb.id = k."batchId"
      JOIN vans v ON v.id = k."vanId"
      LEFT JOIN (
        SELECT "batchId", "vanId", SUM(quantity) AS qty, SUM(quantity * "unitCost") AS cost
        FROM assign_rows GROUP BY "batchId", "vanId"
      ) assign_agg ON assign_agg."batchId" = k."batchId" AND assign_agg."vanId" = k."vanId"
      LEFT JOIN (
        SELECT "batchId", "vanId", SUM(quantity) AS qty, SUM(quantity * price) AS revenue,
          SUM(quantity * "unitCost") AS cogs, SUM(quantity * (price - "unitCost")) AS profit
        FROM sale_rows GROUP BY "batchId", "vanId"
      ) sale_agg ON sale_agg."batchId" = k."batchId" AND sale_agg."vanId" = k."vanId"
      LEFT JOIN (
        SELECT "batchId", "vanId", SUM(quantity) AS qty, SUM(quantity * "unitCost") AS cost
        FROM loss_rows GROUP BY "batchId", "vanId"
      ) loss_agg ON loss_agg."batchId" = k."batchId" AND loss_agg."vanId" = k."vanId"
      LEFT JOIN (
        SELECT "batchId", "vanId", SUM(quantity) AS qty
        FROM current_rows GROUP BY "batchId", "vanId"
      ) current_agg ON current_agg."batchId" = k."batchId" AND current_agg."vanId" = k."vanId"
      ORDER BY sb.date DESC, k."batchId" DESC, v."vanName" ASC
      OFFSET ${skip}
      LIMIT ${take}
    `;
  }

  private mapTotals(row?: BatchVanProfitabilityTotalsDbRow): BatchVanProfitabilityTotals {
    const totalSell = this.num(row?.totalSell);
    const grossProfit = this.num(row?.grossProfit);
    return {
      totalSell,
      totalCost: this.num(row?.totalCost),
      grossProfit,
      profitMargin: this.margin(grossProfit, totalSell),
      assignedQty: this.num(row?.assignedQty),
      assignedCost: this.num(row?.assignedCost),
      soldQty: this.num(row?.soldQty),
      lossQty: this.num(row?.lossQty),
      lossCost: this.num(row?.lossCost),
      batchCount: this.num(row?.batchCount),
    };
  }

  private mapRow(row: BatchVanProfitabilityDbRow): BatchVanProfitabilityRow {
    const soldRevenue = this.num(row.soldRevenue);
    const grossProfit = this.num(row.grossProfit);
    return {
      batchId: row.batchId,
      date: row.date,
      source: row.source,
      vanId: row.vanId,
      vanName: row.vanName,
      assignedQty: this.num(row.assignedQty),
      assignedCost: this.num(row.assignedCost),
      soldQty: this.num(row.soldQty),
      soldRevenue,
      soldCogs: this.num(row.soldCogs),
      grossProfit,
      profitMargin: this.margin(grossProfit, soldRevenue),
      lossQty: this.num(row.lossQty),
      lossCost: this.num(row.lossCost),
      remainingQty: this.num(row.remainingQty),
    };
  }

  private num(value: NumericLike | undefined): number {
    if (typeof value === 'bigint') return Number(value);
    return value ?? 0;
  }

  private margin(profit: number, revenue: number): number {
    if (revenue === 0) return 0;
    return Math.round((profit / revenue) * 10000) / 100;
  }

  private assertMonth(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'month must be YYYY-MM',
        fields: { month: 'invalid format' },
      });
    }
  }
}
