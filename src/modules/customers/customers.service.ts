import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { listResponse, ListResponse } from '../../common/dto/pagination.dto';
import { PrefixIdService } from '../../common/services/prefix-id.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers.query';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const SORTABLE = ['name', 'type', 'createdAt'] as const;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: PrefixIdService,
  ) {}

  async create(dto: CreateCustomerDto) {
    return this.prisma.$transaction(async (tx) => {
      const id = await this.ids.next('CUS', 3, tx);
      const customer = await tx.customer.create({ data: { id, ...dto } });
      await tx.auditLog.create({
        data: {
          action: AuditAction.CREATE,
          entity: 'Customer',
          entityId: id,
          after: customer as unknown as Prisma.InputJsonValue,
        },
      });
      return customer;
    });
  }

  async findAll(q: ListCustomersQueryDto): Promise<ListResponse<unknown>> {
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { phone: { contains: q.q, mode: 'insensitive' } },
              { id: { contains: q.q.toUpperCase() } },
            ],
          }
        : {}),
    };
    const orderBy = q.parseSort(SORTABLE) ?? { createdAt: 'desc' };
    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({ where, orderBy, skip: q.skip, take: q.take }),
      this.prisma.customer.count({ where }),
    ]);
    return listResponse(items, total, q);
  }

  async findOne(id: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: `Customer ${id} not found` });
    return c;
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const before = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.customer.update({ where: { id }, data: dto });
      await tx.auditLog.create({
        data: {
          action: AuditAction.UPDATE,
          entity: 'Customer',
          entityId: id,
          before: before as unknown as Prisma.InputJsonValue,
          after: after as unknown as Prisma.InputJsonValue,
        },
      });
      return after;
    });
  }

  async remove(id: string) {
    const before = await this.findOne(id);
    await this.assertNotInUse(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          action: AuditAction.DELETE,
          entity: 'Customer',
          entityId: id,
          before: before as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }

  private async assertNotInUse(id: string): Promise<void> {
    const [orders, sales, invoices] = await Promise.all([
      this.prisma.distributionOrder.count({ where: { customerId: id, deletedAt: null } }),
      this.prisma.sale.count({ where: { customerId: id, deletedAt: null } }),
      this.prisma.invoice.count({ where: { customerId: id, deletedAt: null } }),
    ]);
    if (orders || sales || invoices) {
      throw new ConflictException({
        code: 'IN_USE',
        message: 'Customer is referenced by existing records and cannot be deleted',
        fields: { distributionOrders: orders, sales, invoices },
      });
    }
  }
}
