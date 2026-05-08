import { BadRequestException, Injectable } from '@nestjs/common';
import { monthBoundsUtc } from '../../common/util/dhaka-time';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  async ledger(month: string) {
    this.assertMonth(month);
    const { startUtc, endUtc, startDateOnly, endDateOnly } = monthBoundsUtc(month);
    const [revAgg, costAgg, expAgg, costRow] = await Promise.all([
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
      this.prisma.$queryRaw<{ cost: bigint | null }[]>`
        SELECT COALESCE(SUM(quantity * "buyingRate"), 0)::bigint as cost
        FROM stock_entries
        WHERE "deletedAt" IS NULL
          AND date >= ${startDateOnly}
          AND date < ${endDateOnly}
      `,
    ]);
    const cost = Number(costRow[0]?.cost ?? 0);
    const revenue = revAgg._sum.total ?? 0;
    const expenses = expAgg._sum.amount ?? 0;
    return {
      month,
      revenue,
      cost,
      expenses,
      grossProfit: revenue - cost,
      netProfit: revenue - cost - expenses,
      stockUnits: costAgg._sum.quantity ?? 0,
    };
  }

  async vanProfitability(month: string) {
    this.assertMonth(month);
    const { startUtc, endUtc, startDateOnly, endDateOnly } = monthBoundsUtc(month);
    const [vans, revByVan, expByVan] = await Promise.all([
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
    ]);
    const revMap = new Map(revByVan.map((r) => [r.vanId, r._sum.total ?? 0]));
    const expMap = new Map(expByVan.map((e) => [e.vanId, e._sum.amount ?? 0]));
    return vans.map((v) => {
      const revenue = revMap.get(v.id) ?? 0;
      const expenses = expMap.get(v.id) ?? 0;
      return {
        vanId: v.id,
        vanName: v.vanName,
        revenue,
        expenses,
        netProfit: revenue - expenses,
      };
    });
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
