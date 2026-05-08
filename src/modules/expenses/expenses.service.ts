import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { stringify as csvStringify } from 'csv-stringify/sync';
import { listResponse, ListResponse } from '../../common/dto/pagination.dto';
import { PrefixIdService } from '../../common/services/prefix-id.service';
import { parseDhakaDateOnly } from '../../common/util/dhaka-time';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses.query';
import { UpdateExpenseDto } from './dto/update-expense.dto';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService, private readonly ids: PrefixIdService) {}

  async create(dto: CreateExpenseDto) {
    const id = await this.ids.next('EXP', 3);
    const expense = await this.prisma.expense.create({
      data: { ...dto, id, date: parseDhakaDateOnly(dto.date) },
    });
    await this.prisma.transaction.create({
      data: {
        occurredAt: new Date(),
        amount: -expense.amount,
        type: TransactionType.expense,
        description: `${expense.category}: ${expense.description}`,
        refTable: 'expenses',
        refId: expense.id,
      },
    });
    return expense;
  }

  async findAll(q: ListExpensesQueryDto): Promise<ListResponse<unknown>> {
    const where = this.buildWhere(q);
    const orderBy = q.parseSort(['date', 'amount', 'createdAt']) ?? { date: 'desc' };
    const [items, total] = await Promise.all([
      this.prisma.expense.findMany({ where, orderBy, skip: q.skip, take: q.take }),
      this.prisma.expense.count({ where }),
    ]);
    return listResponse(items, total, q);
  }

  async findOne(id: string) {
    const e = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!e) throw new NotFoundException({ code: 'NOT_FOUND', message: `Expense ${id} not found` });
    return e;
  }

  async update(id: string, dto: UpdateExpenseDto) {
    await this.findOne(id);
    return this.prisma.expense.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.date ? { date: parseDhakaDateOnly(dto.date) } : {}),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.expense.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async exportCsv(q: ListExpensesQueryDto): Promise<string> {
    const where = this.buildWhere(q);
    const rows = await this.prisma.expense.findMany({ where, orderBy: { date: 'desc' } });
    return csvStringify(
      rows.map((r) => ({
        id: r.id,
        date: r.date.toISOString().slice(0, 10),
        category: r.category,
        amount: r.amount,
        description: r.description,
        status: r.status,
        vanId: r.vanId ?? '',
      })),
      { header: true },
    );
  }

  private buildWhere(q: ListExpensesQueryDto): Prisma.ExpenseWhereInput {
    return {
      deletedAt: null,
      ...(q.category ? { category: q.category } : {}),
      ...(q.status ? { status: q.status } : {}),
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
              { description: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }
}
