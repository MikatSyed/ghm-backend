import { BadRequestException, Injectable } from '@nestjs/common';
import { stringify as csvStringify } from 'csv-stringify/sync';
import { parseDhakaDateOnly } from '../../common/util/dhaka-time';
import { PrismaService } from '../../prisma/prisma.service';

export type ReportType = 'sales' | 'expenses' | 'stock' | 'profit-by-van';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async run(type: ReportType, dateFrom?: string, dateTo?: string) {
    const range = this.range(dateFrom, dateTo);
    switch (type) {
      case 'sales':
        return this.salesReport(range);
      case 'expenses':
        return this.expensesReport(range);
      case 'stock':
        return this.stockReport(range);
      case 'profit-by-van':
        return this.profitByVan(range);
      default:
        throw new BadRequestException({ code: 'UNKNOWN_REPORT', message: `Unknown report ${type}` });
    }
  }

  toCsv(rows: Record<string, unknown>[]): string {
    return csvStringify(rows, { header: true });
  }

  private range(from?: string, to?: string) {
    return {
      gte: from ? parseDhakaDateOnly(from) : undefined,
      lte: to ? parseDhakaDateOnly(to) : undefined,
    };
  }

  private async salesReport(range: { gte?: Date; lte?: Date }) {
    const rows = await this.prisma.invoice.findMany({
      where: {
        deletedAt: null,
        ...(range.gte || range.lte ? { date: { ...(range.gte ? { gte: range.gte } : {}), ...(range.lte ? { lte: range.lte } : {}) } } : {}),
      },
      include: { van: true, _count: { select: { items: true } } },
      orderBy: { date: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      van: r.van.vanName,
      items: r._count.items,
      total: r.total,
      status: r.status,
    }));
  }

  private async expensesReport(range: { gte?: Date; lte?: Date }) {
    const rows = await this.prisma.expense.findMany({
      where: {
        deletedAt: null,
        ...(range.gte || range.lte ? { date: { ...(range.gte ? { gte: range.gte } : {}), ...(range.lte ? { lte: range.lte } : {}) } } : {}),
      },
      orderBy: { date: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      category: r.category,
      amount: r.amount,
      description: r.description,
      status: r.status,
      vanId: r.vanId ?? '',
    }));
  }

  private async stockReport(range: { gte?: Date; lte?: Date }) {
    const rows = await this.prisma.stockEntry.findMany({
      where: {
        deletedAt: null,
        ...(range.gte || range.lte ? { date: { ...(range.gte ? { gte: range.gte } : {}), ...(range.lte ? { lte: range.lte } : {}) } } : {}),
      },
      include: { product: { select: { name: true, unit: true } } },
      orderBy: { date: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      product: r.product.name,
      unit: r.product.unit,
      quantity: r.quantity,
      buyingRate: r.buyingRate,
      total: r.quantity * r.buyingRate,
      source: r.source,
    }));
  }

  private async profitByVan(range: { gte?: Date; lte?: Date }) {
    const dateFilter =
      range.gte || range.lte
        ? { date: { ...(range.gte ? { gte: range.gte } : {}), ...(range.lte ? { lte: range.lte } : {}) } }
        : {};
    const [vans, revByVan, expByVan] = await Promise.all([
      this.prisma.van.findMany({ where: { deletedAt: null } }),
      this.prisma.invoice.groupBy({
        by: ['vanId'],
        where: { deletedAt: null, ...dateFilter },
        _sum: { total: true },
      }),
      this.prisma.expense.groupBy({
        by: ['vanId'],
        where: { deletedAt: null, vanId: { not: null }, ...dateFilter },
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
}
