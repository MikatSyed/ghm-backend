import { Injectable } from '@nestjs/common';
import { listResponse, ListResponse } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchQueryDto } from './dto/search.query';

export interface Row {
  id: string;
  type: 'sales' | 'stock' | 'expenses' | 'returns';
  title: string;
  amount: number;
  date: string;
  van: string;
  status: string;
  category: string;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: SearchQueryDto): Promise<ListResponse<Row>> {
    const dateGte = this.dateRangeStart(q.dateRange);
    const search = q.q?.trim();
    const kind = q.kind ?? 'all';

    const tasks: Array<Promise<Row[]>> = [];
    if (kind === 'all' || kind === 'sales') tasks.push(this.searchSales(search, q.vanId, dateGte));
    if (kind === 'all' || kind === 'stock') tasks.push(this.searchStock(search, dateGte));
    if (kind === 'all' || kind === 'expenses') tasks.push(this.searchExpenses(search, q.category, q.vanId, dateGte));
    if (kind === 'all' || kind === 'returns') tasks.push(this.searchReturns(search, q.vanId, dateGte));

    const all = (await Promise.all(tasks)).flat();
    all.sort((a, b) => (a.date < b.date ? 1 : -1));

    const total = all.length;
    const page = all.slice(q.skip, q.skip + q.take);
    return listResponse(page, total, q);
  }

  private async searchSales(qStr: string | undefined, vanId: string | undefined, gte?: Date): Promise<Row[]> {
    const rows = await this.prisma.invoice.findMany({
      where: {
        deletedAt: null,
        ...(vanId ? { vanId } : {}),
        ...(gte ? { createdAt: { gte } } : {}),
        ...(qStr
          ? {
              OR: [
                { id: { contains: qStr.toUpperCase() } },
                { van: { vanName: { contains: qStr, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { van: { select: { vanName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      type: 'sales' as const,
      title: `Invoice ${r.id}`,
      amount: r.total,
      date: r.date.toISOString().slice(0, 10),
      van: r.van.vanName,
      status: r.status === 'paid' ? 'completed' : 'pending',
      category: 'Sales',
    }));
  }

  private async searchStock(qStr: string | undefined, gte?: Date): Promise<Row[]> {
    const rows = await this.prisma.stockEntry.findMany({
      where: {
        deletedAt: null,
        ...(gte ? { date: { gte } } : {}),
        ...(qStr
          ? {
              OR: [
                { id: { contains: qStr.toUpperCase() } },
                { source: { contains: qStr, mode: 'insensitive' } },
                { product: { name: { contains: qStr, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { product: { include: { category: true } } },
      orderBy: { date: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      type: 'stock' as const,
      title: `${r.product.name} from ${r.source}`,
      amount: r.quantity * r.buyingRate,
      date: r.date.toISOString().slice(0, 10),
      van: '',
      status: 'stored',
      category: r.product.category.name,
    }));
  }

  private async searchExpenses(
    qStr: string | undefined,
    category: string | undefined,
    vanId: string | undefined,
    gte?: Date,
  ): Promise<Row[]> {
    const rows = await this.prisma.expense.findMany({
      where: {
        deletedAt: null,
        ...(vanId ? { vanId } : {}),
        ...(category ? { category } : {}),
        ...(gte ? { date: { gte } } : {}),
        ...(qStr
          ? {
              OR: [
                { id: { contains: qStr.toUpperCase() } },
                { description: { contains: qStr, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { date: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      type: 'expenses' as const,
      title: r.description,
      amount: r.amount,
      date: r.date.toISOString().slice(0, 10),
      van: r.vanId ?? '',
      status: r.status === 'paid' ? 'completed' : 'pending',
      category: r.category,
    }));
  }

  private async searchReturns(qStr: string | undefined, vanId: string | undefined, gte?: Date): Promise<Row[]> {
    const lines = await this.prisma.distributionLine.findMany({
      where: {
        returned: { gt: 0 },
        ...(vanId ? { distribution: { vanId } } : {}),
        ...(gte ? { distribution: { date: { gte } } } : {}),
        ...(qStr
          ? {
              OR: [
                { product: { name: { contains: qStr, mode: 'insensitive' } } },
                { distribution: { id: { contains: qStr.toUpperCase() } } },
              ],
            }
          : {}),
      },
      include: {
        distribution: { include: { van: { select: { vanName: true } } } },
        product: { include: { category: true } },
      },
      orderBy: { distribution: { date: 'desc' } },
      take: 200,
    });
    return lines.map((l) => ({
      id: l.id,
      type: 'returns' as const,
      title: `${l.product.name} return (${l.returned})`,
      amount: l.returned,
      date: l.distribution.date.toISOString().slice(0, 10),
      van: l.distribution.van.vanName,
      status: 'processed',
      category: l.product.category.name,
    }));
  }

  private dateRangeStart(range?: SearchQueryDto['dateRange']): Date | undefined {
    if (!range) return undefined;
    const now = new Date();
    const d = new Date(now);
    switch (range) {
      case '7d':
        d.setDate(d.getDate() - 7);
        return d;
      case '30d':
        d.setDate(d.getDate() - 30);
        return d;
      case '90d':
        d.setDate(d.getDate() - 90);
        return d;
      case 'ytd':
        return new Date(now.getFullYear(), 0, 1);
    }
  }
}
