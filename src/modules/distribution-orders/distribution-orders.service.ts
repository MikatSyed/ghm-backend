import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  DistributionOrderStatus,
  InvoiceStatus,
  Prisma,
  SaleType,
  StockLotConsumerType,
  TransactionType,
} from '@prisma/client';
import { ListResponse, listResponse } from '../../common/dto/pagination.dto';
import { PrefixIdService } from '../../common/services/prefix-id.service';
import { StockLotService } from '../../common/services/stock-lot.service';
import { parseDhakaDateOnly } from '../../common/util/dhaka-time';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfirmDistributionOrderDto } from './dto/confirm-distribution-order.dto';
import { CreateDistributionOrderDto } from './dto/create-distribution-order.dto';
import { ListDistributionOrdersQueryDto } from './dto/list-distribution-orders.query';

@Injectable()
export class DistributionOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: PrefixIdService,
    private readonly lots: StockLotService,
  ) {}

  /**
   * Creates the issue document only — no StockLotAllocation, no Product.stock
   * change. Unlike Distribution (warehouse→van), stock only moves at confirm.
   */
  async create(dto: CreateDistributionOrderDto) {
    const date = parseDhakaDateOnly(dto.date);
    const id = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: dto.customerId, deletedAt: null },
      });
      if (!customer) {
        throw new BadRequestException({
          code: 'INVALID_CUSTOMER',
          message: `Customer ${dto.customerId} not found`,
          fields: { customerId: 'unknown' },
        });
      }

      const reqProductIds = dto.lines.map((l) => l.productId);
      const products = await tx.product.findMany({
        where: { id: { in: reqProductIds }, deletedAt: null },
        select: { id: true },
      });
      if (products.length !== new Set(reqProductIds).size) {
        const known = new Set(products.map((p) => p.id));
        const missing = reqProductIds.find((pid) => !known.has(pid));
        throw new BadRequestException({
          code: 'INVALID_PRODUCT',
          message: `Product ${missing} not found`,
        });
      }

      const newId = await this.ids.next('DOR', 3, tx);
      await tx.distributionOrder.create({
        data: {
          id: newId,
          customerId: dto.customerId,
          date,
          lines: {
            create: dto.lines.map((l) => ({
              productId: l.productId,
              requestedQty: l.requestedQty,
              price: l.price,
            })),
          },
        },
      });
      return newId;
    });

    return this.findOne(id);
  }

  async findAll(q: ListDistributionOrdersQueryDto): Promise<ListResponse<unknown>> {
    const where: Prisma.DistributionOrderWhereInput = {
      deletedAt: null,
      ...(q.customerId ? { customerId: q.customerId } : {}),
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
              { customer: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const orderBy = q.parseSort(['date', 'createdAt']) ?? { date: 'desc' };
    const [items, total] = await Promise.all([
      this.prisma.distributionOrder.findMany({
        where,
        orderBy,
        skip: q.skip,
        take: q.take,
        include: {
          customer: { select: { name: true, type: true } },
          lines: { include: { product: { select: { name: true, unit: true } } } },
        },
      }),
      this.prisma.distributionOrder.count({ where }),
    ]);
    return listResponse(items, total, q);
  }

  async findOne(id: string) {
    const order = await this.prisma.distributionOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        customer: true,
        lines: { include: { product: { select: { name: true, unit: true } } } },
      },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Distribution order ${id} not found`,
      });
    }
    return order;
  }

  /**
   * Confirms delivered quantities: creates a Sale + Invoice for the confirmed
   * lines only, allocating FIFO warehouse lots straight to SALE_ITEM (no
   * DistributionLine/van hop — this order never touched a van). Lines with no
   * confirmed quantity (omitted or explicitly 0) stay at confirmedQty 0,
   * i.e. the undelivered remainder is implicitly cancelled.
   */
  async confirm(id: string, dto: ConfirmDistributionOrderDto) {
    const { invoice, sale, productIds } = await this.prisma.$transaction(
      async (tx) => {
        const order = await tx.distributionOrder.findFirst({
          where: { id, deletedAt: null },
          include: { lines: true, customer: true },
        });
        if (!order) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: `Distribution order ${id} not found`,
          });
        }

        const lineIds = new Set(order.lines.map((l) => l.productId));
        for (const dl of dto.lines) {
          if (!lineIds.has(dl.productId)) {
            throw new BadRequestException({
              code: 'INVALID_LINE',
              message: `Product ${dl.productId} is not on distribution order ${id}`,
            });
          }
        }

        const dtoByProduct = new Map(dto.lines.map((l) => [l.productId, l]));
        const confirmed = order.lines
          .map((line) => {
            const dl = dtoByProduct.get(line.productId);
            const confirmedQty = Math.min(Math.max(dl?.confirmedQty ?? 0, 0), line.requestedQty);
            return { line, confirmedQty, price: dl?.price ?? 0 };
          })
          .filter((c) => c.confirmedQty > 0);

        if (confirmed.length === 0) {
          throw new BadRequestException({
            code: 'NOTHING_CONFIRMED',
            message: 'At least one line must have a confirmed quantity greater than zero',
          });
        }

        // Atomic guard: only flips status if still `issued`. This is what
        // actually prevents a double-confirm race — not the read above.
        const guard = await tx.distributionOrder.updateMany({
          where: { id, status: DistributionOrderStatus.issued },
          data: { status: DistributionOrderStatus.confirmed, confirmedAt: new Date() },
        });
        if (guard.count === 0) {
          throw new ConflictException({
            code: 'ALREADY_CONFIRMED',
            message: 'Distribution order is not in issued state',
          });
        }

        const total = confirmed.reduce((s, c) => s + c.confirmedQty * c.price, 0);
        const invoiceId = await this.ids.next('INV', 4, tx);
        const saleId = await this.ids.next('SAL', 3, tx);
        const productMap = new Map(
          (
            await tx.product.findMany({
              where: { id: { in: confirmed.map((c) => c.line.productId) } },
            })
          ).map((p) => [p.id, p]),
        );

        const [invoice, sale] = await Promise.all([
          tx.invoice.create({
            data: {
              id: invoiceId,
              customerId: order.customerId,
              date: order.date,
              total,
              status: InvoiceStatus.unpaid,
              items: {
                create: confirmed.map((c) => {
                  const p = productMap.get(c.line.productId)!;
                  return {
                    productId: c.line.productId,
                    name: p.name,
                    price: c.price,
                    qty: c.confirmedQty,
                    subtotal: c.price * c.confirmedQty,
                  };
                }),
              },
            },
            include: { items: true, customer: true },
          }),
          tx.sale.create({
            data: {
              id: saleId,
              customerId: order.customerId,
              type: SaleType.DISTRIBUTION_CONFIRMATION,
              date: order.date,
              total,
              invoiceId,
              items: {
                create: confirmed.map((c) => ({
                  productId: c.line.productId,
                  price: c.price,
                  qty: c.confirmedQty,
                })),
              },
            },
            include: { items: true },
          }),
        ]);

        // FIFO-consume warehouse lots straight to SALE_ITEM — no van hop,
        // since this order's stock never left the warehouse before confirm.
        const allocatedPerItem = await Promise.all(
          sale.items.map((saleItem) =>
            this.lots
              .allocateFromWarehouse(tx, saleItem.productId, saleItem.qty)
              .then((slices) => ({ saleItem, slices })),
          ),
        );
        const allocationRows = allocatedPerItem.flatMap(({ saleItem, slices }) =>
          slices.map((s) => ({
            stockEntryId: s.stockEntryId,
            consumerType: StockLotConsumerType.SALE_ITEM,
            consumerId: saleItem.id,
            quantity: s.quantity,
            unitCost: s.unitCost,
          })),
        );
        const cogs = allocationRows.reduce((sum, r) => sum + r.quantity * r.unitCost, 0);

        const notConfirmed = order.lines.filter((l) => !confirmed.some((c) => c.line.id === l.id));

        await Promise.all([
          allocationRows.length
            ? tx.stockLotAllocation.createMany({ data: allocationRows })
            : Promise.resolve(),
          tx.distributionOrder.update({ where: { id }, data: { saleId: sale.id } }),
          ...confirmed.map((c) =>
            tx.distributionOrderLine.update({
              where: { id: c.line.id },
              data: { confirmedQty: c.confirmedQty, price: c.price },
            }),
          ),
          ...notConfirmed.map((l) =>
            tx.distributionOrderLine.update({ where: { id: l.id }, data: { confirmedQty: 0 } }),
          ),
          tx.transaction.create({
            data: {
              occurredAt: new Date(),
              amount: total,
              type: TransactionType.sale,
              description: `Distribution confirmation for ${order.customer.name} (${confirmed.length} items)`,
              refTable: 'invoices',
              refId: invoice.id,
            },
          }),
        ]);

        await tx.auditLog.create({
          data: {
            action: AuditAction.UPDATE,
            entity: 'DistributionOrder',
            entityId: id,
            meta: {
              saleId: sale.id,
              invoiceId: invoice.id,
              total,
              cogs,
              confirmed: confirmed.map((c) => ({
                productId: c.line.productId,
                confirmedQty: c.confirmedQty,
                price: c.price,
              })),
            } as unknown as Prisma.InputJsonValue,
          },
        });

        const productIds = Array.from(new Set(confirmed.map((c) => c.line.productId)));
        return { invoice, sale, productIds };
      },
      { timeout: 30000, maxWait: 8000 },
    );

    await this.recomputeProductsBestEffort(productIds);

    return {
      distributionOrderId: id,
      saleId: sale.id,
      invoiceId: invoice.id,
      customer: invoice.customer?.name,
      date: invoice.date.toISOString().slice(0, 10),
      items: invoice.items.length,
      total: invoice.total,
      status: invoice.status,
    };
  }

  /** Cancels an issued order. No stock to reverse — nothing was ever allocated. */
  async cancel(id: string) {
    const guard = await this.prisma.distributionOrder.updateMany({
      where: { id, deletedAt: null, status: DistributionOrderStatus.issued },
      data: { status: DistributionOrderStatus.cancelled },
    });
    if (guard.count === 0) {
      const exists = await this.prisma.distributionOrder.findFirst({
        where: { id, deletedAt: null },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: `Distribution order ${id} not found`,
        });
      }
      throw new ConflictException({
        code: 'NOT_ISSUED',
        message: 'Only issued orders can be cancelled',
      });
    }
    return this.findOne(id);
  }

  /**
   * Recompute Product.stock outside the confirm transaction, same best-effort
   * pattern as distributions.service.ts — a failure here just leaves stock
   * momentarily stale until the next mutation on the same product.
   */
  private async recomputeProductsBestEffort(productIds: string[]) {
    for (const pid of productIds) {
      try {
        await this.prisma.$transaction(async (tx) => this.lots.recomputeProductStock(tx, pid), {
          timeout: 30000,
          maxWait: 5000,
        });
      } catch {
        // swallow — best-effort
      }
    }
  }
}
