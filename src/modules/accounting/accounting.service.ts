import { BadRequestException, Injectable } from '@nestjs/common';
import { monthBoundsUtc } from '../../common/util/dhaka-time';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  async ledger(month: string) {
    this.assertMonth(month);
    const { startUtc, endUtc, startDateOnly, endDateOnly } = monthBoundsUtc(month);
    const [revAgg, stockAgg, expAgg, cogsRow] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: { deletedAt: null, createdAt: { gte: startUtc, lt: endUtc } },
        _sum: { total: true },
      }),
      this.prisma.stockEntry.aggregate({
        where: { deletedAt: null, date: { gte: startDateOnly, lt: endDateOnly } },
        _sum: { quantity: true },
      }),
      this.prisma.expense.aggregate({
        where: { deletedAt: null, date: { gte: startDateOnly, lt: endDateOnly } },
        _sum: { amount: true },
      }),
      this.cogsQuery(startUtc, endUtc),
    ]);
    const cost = Number(cogsRow[0]?.cogs ?? 0);
    const revenue = revAgg._sum.total ?? 0;
    const expenses = expAgg._sum.amount ?? 0;
    return {
      month,
      revenue,
      cost,
      expenses,
      grossProfit: revenue - cost,
      netProfit: revenue - cost - expenses,
      stockUnits: stockAgg._sum.quantity ?? 0,
    };
  }

  async vanProfitability(month: string) {
    this.assertMonth(month);
    const { startUtc, endUtc, startDateOnly, endDateOnly } = monthBoundsUtc(month);
    const [vans, revByVan, expByVan, cogsByVan] = await Promise.all([
      this.prisma.van.findMany({ where: { deletedAt: null } }),
      this.prisma.invoice.groupBy({
        by: ['vanId'],
        where: { deletedAt: null, createdAt: { gte: startUtc, lt: endUtc } },
        _sum: { total: true },
      }),
      this.prisma.expense.groupBy({
        by: ['vanId'],
        where: {
          deletedAt: null,
          vanId: { not: null },
          date: { gte: startDateOnly, lt: endDateOnly },
        },
        _sum: { amount: true },
      }),
      this.cogsByVanQuery(startUtc, endUtc),
    ]);
    const revMap = new Map(revByVan.map((r) => [r.vanId, r._sum.total ?? 0]));
    const expMap = new Map(expByVan.map((e) => [e.vanId, e._sum.amount ?? 0]));
    const cogsMap = new Map(cogsByVan.map((c) => [c.vanId, Number(c.cogs)]));
    return vans.map((v) => {
      const revenue = revMap.get(v.id) ?? 0;
      const expenses = expMap.get(v.id) ?? 0;
      const cogs = cogsMap.get(v.id) ?? 0;
      return {
        vanId: v.id,
        vanName: v.vanName,
        revenue,
        cogs,
        expenses,
        netProfit: revenue - cogs - expenses,
      };
    });
  }

  /**
   * True cost of goods sold: SALE_ITEM lot allocations (unitCost snapshot at
   * consumption time) joined through to invoices created in [start, end),
   * matching the date basis used for `revenue`. This replaces the old
   * "stock purchased in the period" proxy, which diverged from what was
   * actually sold.
   */
  private cogsQuery(start: Date, end: Date) {
    return this.prisma.$queryRaw<{ cogs: bigint | null }[]>`
      SELECT COALESCE(SUM(a.quantity * a."unitCost"), 0)::bigint as cogs
      FROM stock_lot_allocations a
      JOIN sale_items si ON si.id = a."consumerId" AND a."consumerType" = 'SALE_ITEM'::"StockLotConsumerType"
      JOIN sales s ON s.id = si."saleId"
      JOIN invoices i ON i.id = s."invoiceId"
      WHERE i."deletedAt" IS NULL
        AND i."createdAt" >= ${start}
        AND i."createdAt" < ${end}
    `;
  }

  private cogsByVanQuery(start: Date, end: Date) {
    return this.prisma.$queryRaw<{ vanId: string | null; cogs: bigint }[]>`
      SELECT s."vanId" as "vanId", COALESCE(SUM(a.quantity * a."unitCost"), 0)::bigint as cogs
      FROM stock_lot_allocations a
      JOIN sale_items si ON si.id = a."consumerId" AND a."consumerType" = 'SALE_ITEM'::"StockLotConsumerType"
      JOIN sales s ON s.id = si."saleId"
      JOIN invoices i ON i.id = s."invoiceId"
      WHERE i."deletedAt" IS NULL
        AND i."createdAt" >= ${start}
        AND i."createdAt" < ${end}
      GROUP BY s."vanId"
    `;
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
