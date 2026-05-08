import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { stringify as csvStringify } from 'csv-stringify/sync';
import { listResponse, ListResponse } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { ListInvoicesQueryDto } from './dto/list-invoices.query';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(q: ListInvoicesQueryDto): Promise<ListResponse<unknown>> {
    const where: Prisma.InvoiceWhereInput = {
      deletedAt: null,
      ...(q.status && q.status !== 'all' ? { status: q.status as InvoiceStatus } : {}),
      ...(q.q
        ? {
            OR: [
              { id: { contains: q.q.toUpperCase() } },
              { van: { vanName: { contains: q.q, mode: 'insensitive' } } },
              { vanId: { contains: q.q.toUpperCase() } },
            ],
          }
        : {}),
    };
    const orderBy = q.parseSort(['date', 'total', 'createdAt']) ?? { createdAt: 'desc' };
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy,
        skip: q.skip,
        take: q.take,
        include: { van: { select: { vanName: true } }, _count: { select: { items: true } } },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    const data = rows.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      van: r.van.vanName,
      vanId: r.vanId,
      items: r._count.items,
      total: r.total,
      status: r.status,
    }));
    return listResponse(data, total, q);
  }

  async findOne(id: string) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id, deletedAt: null },
      include: { van: true, items: true },
    });
    if (!inv) throw new NotFoundException({ code: 'NOT_FOUND', message: `Invoice ${id} not found` });
    return inv;
  }

  async update(id: string, dto: UpdateInvoiceDto) {
    const inv = await this.findOne(id);
    if (inv.status === 'paid' && dto.status && dto.status !== 'paid') {
      throw new BadRequestException({
        code: 'INVOICE_LOCKED',
        message: 'Paid invoices cannot revert status.',
      });
    }
    return this.prisma.invoice.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.status === 'paid' ? { paidAt: new Date() } : {}),
      },
      include: { van: true, items: true },
    });
  }

  async exportCsv(q: ListInvoicesQueryDto): Promise<string> {
    const where: Prisma.InvoiceWhereInput = {
      deletedAt: null,
      ...(q.status && q.status !== 'all' ? { status: q.status as InvoiceStatus } : {}),
    };
    const rows = await this.prisma.invoice.findMany({
      where,
      orderBy: { date: 'desc' },
      include: { van: true, _count: { select: { items: true } } },
    });
    return csvStringify(
      rows.map((r) => ({
        id: r.id,
        date: r.date.toISOString().slice(0, 10),
        vanId: r.vanId,
        van: r.van.vanName,
        items: r._count.items,
        total: r.total,
        status: r.status,
      })),
      { header: true },
    );
  }
}
