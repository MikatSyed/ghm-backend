import { Injectable } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import {
  DHAKA_TZ,
  dhakaDayBoundsUtc,
  dhakaRangeUtc,
  dhakaTodayDateOnly,
} from '../../common/util/dhaka-time';
import { PrismaService } from '../../prisma/prisma.service';

type Timeframe = 'daily' | 'weekly' | 'monthly' | 'yearly';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async metrics() {
    const { startUtc, endUtc } = dhakaDayBoundsUtc();
    const today = dhakaTodayDateOnly();
    const [revenueAgg, expenseAgg, stockAgg, lowStock, todayInvoices] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: { deletedAt: null, createdAt: { gte: startUtc, lt: endUtc } },
        _sum: { total: true },
      }),
      this.prisma.expense.aggregate({
        where: { deletedAt: null, date: today },
        _sum: { amount: true },
      }),
      this.prisma.product.aggregate({
        where: { deletedAt: null },
        _sum: { stock: true },
      }),
      this.prisma.product.count({
        where: { deletedAt: null, stock: { lte: 10 } },
      }),
      this.prisma.invoice.count({
        where: { deletedAt: null, createdAt: { gte: startUtc, lt: endUtc } },
      }),
    ]);
    const revenue = revenueAgg._sum.total ?? 0;
    const expenses = expenseAgg._sum.amount ?? 0;
    return {
      todayRevenue: revenue,
      todayExpenses: expenses,
      todayProfit: revenue - expenses,
      todayInvoices,
      stockOnHand: stockAgg._sum.stock ?? 0,
      lowStockCount: lowStock,
    };
  }

  async series(timeframe: Timeframe) {
    const { startUtc, endUtc } = dhakaRangeUtc(timeframe);
    const startDateOnly = this.toUtcDateOnly(startUtc);
    const endDateOnly = this.toUtcDateOnly(endUtc);
    const [invoices, expenses, stockEntries] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { deletedAt: null, createdAt: { gte: startUtc, lt: endUtc } },
        select: { total: true, createdAt: true, items: { select: { qty: true } } },
      }),
      this.prisma.expense.findMany({
        where: { deletedAt: null, date: { gte: startDateOnly, lte: endDateOnly } },
        select: { amount: true, date: true },
      }),
      this.prisma.stockEntry.findMany({
        where: { deletedAt: null, date: { gte: startDateOnly, lte: endDateOnly } },
        select: { quantity: true, buyingRate: true, date: true },
      }),
    ]);

    const bucket: Record<string, { revenue: number; cost: number; expense: number; stock: number }> = {};
    const fmt = this.bucketFormat(timeframe);

    for (const inv of invoices) {
      const k = format(toZonedTime(inv.createdAt, DHAKA_TZ), fmt);
      bucket[k] ??= { revenue: 0, cost: 0, expense: 0, stock: 0 };
      bucket[k].revenue += inv.total;
    }
    for (const e of expenses) {
      const k = format(toZonedTime(e.date, DHAKA_TZ), fmt);
      bucket[k] ??= { revenue: 0, cost: 0, expense: 0, stock: 0 };
      bucket[k].expense += e.amount;
    }
    for (const s of stockEntries) {
      const k = format(toZonedTime(s.date, DHAKA_TZ), fmt);
      bucket[k] ??= { revenue: 0, cost: 0, expense: 0, stock: 0 };
      bucket[k].cost += s.quantity * s.buyingRate;
      bucket[k].stock += s.quantity;
    }

    return Object.entries(bucket)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([label, v]) => ({
        label,
        revenue: v.revenue,
        cost: v.cost,
        profit: v.revenue - v.cost - v.expense,
        stock: v.stock,
      }));
  }

  private toUtcDateOnly(utcInstant: Date): Date {
    const ymd = format(toZonedTime(utcInstant, DHAKA_TZ), 'yyyy-MM-dd');
    return new Date(`${ymd}T00:00:00.000Z`);
  }

  private bucketFormat(t: Timeframe): string {
    switch (t) {
      case 'daily':
        return 'HH:00';
      case 'weekly':
        return 'EEE';
      case 'monthly':
        return 'dd';
      case 'yearly':
        return 'MMM';
    }
  }

  async vanPerformance() {
    const [vans, revByVan, lineAggByDistro] = await Promise.all([
      this.prisma.van.findMany({ where: { deletedAt: null } }),
      this.prisma.invoice.groupBy({
        by: ['vanId'],
        where: { deletedAt: null },
        _sum: { total: true },
      }),
      this.prisma.distributionLine.groupBy({
        by: ['distributionId'],
        _sum: { allocated: true, returned: true },
      }),
    ]);
    const distroIds = lineAggByDistro.map((d) => d.distributionId);
    const distros = distroIds.length
      ? await this.prisma.distribution.findMany({
          where: { id: { in: distroIds } },
          select: { id: true, vanId: true },
        })
      : [];
    const distroToVan = new Map(distros.map((d) => [d.id, d.vanId]));
    const aggByVan = new Map<string, { allocated: number; returned: number }>();
    for (const row of lineAggByDistro) {
      const vid = distroToVan.get(row.distributionId);
      if (!vid) continue;
      const cur = aggByVan.get(vid) ?? { allocated: 0, returned: 0 };
      cur.allocated += row._sum.allocated ?? 0;
      cur.returned += row._sum.returned ?? 0;
      aggByVan.set(vid, cur);
    }
    const revMap = new Map(revByVan.map((r) => [r.vanId, r._sum.total ?? 0]));
    return vans.map((v) => {
      const { allocated = 0, returned = 0 } = aggByVan.get(v.id) ?? {};
      const sold = allocated - returned;
      return {
        van: v.vanName,
        revenue: revMap.get(v.id) ?? 0,
        efficiency: allocated === 0 ? 0 : Math.round((sold / allocated) * 100),
        returned,
      };
    });
  }

  async categoryBreakdown() {
    const { startUtc, endUtc } = dhakaDayBoundsUtc();
    const rows = await this.prisma.$queryRaw<{ name: string; total: bigint }[]>`
      SELECT c.name as name, COALESCE(SUM(ii.subtotal), 0)::bigint as total
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii."invoiceId"
      JOIN products p ON p.id = ii."productId"
      JOIN categories c ON c.id = p."categoryId"
      WHERE i."deletedAt" IS NULL
        AND i."createdAt" >= ${startUtc}
        AND i."createdAt" < ${endUtc}
      GROUP BY c.name
    `;
    const totals = rows.map((r) => ({ name: r.name, total: Number(r.total) }));
    const grand = totals.reduce((s, t) => s + t.total, 0);
    return totals.map((t) => ({
      name: t.name,
      value: grand === 0 ? 0 : Math.round((t.total / grand) * 100),
    }));
  }

  async lowStock(threshold = 10) {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null, stock: { lte: threshold } },
      orderBy: { stock: 'asc' },
      take: 20,
      include: { category: true },
    });
    return products.map((p) => ({
      productId: p.id,
      name: p.name,
      stock: p.stock,
      unit: p.unit,
      category: p.category.name,
    }));
  }

  async activity(limit = 10) {
    const txs = await this.prisma.transaction.findMany({
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
    return txs.map((t) => ({
      id: t.id,
      date: t.occurredAt.toISOString(),
      amount: t.amount,
      type: t.type as TransactionType,
      description: t.description,
    }));
  }
}
