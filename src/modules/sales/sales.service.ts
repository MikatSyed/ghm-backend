import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  InvoiceStatus,
  Prisma,
  StockLotConsumerType,
  TransactionType,
} from '@prisma/client';
import { ListResponse, listResponse } from '../../common/dto/pagination.dto';
import { InsufficientStockException } from '../../common/exceptions/insufficient-stock.exception';
import { PrefixIdService } from '../../common/services/prefix-id.service';
import { StockLotService } from '../../common/services/stock-lot.service';
import { parseDhakaDateOnly } from '../../common/util/dhaka-time';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ListSalesQueryDto } from './dto/list-sales.query';

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: PrefixIdService,
    private readonly lots: StockLotService,
  ) {}

  async finalize(dto: CreateSaleDto) {
    const date = parseDhakaDateOnly(dto.date);
    return this.prisma.$transaction(
      async (tx) => {
      const van = await tx.van.findFirst({ where: { id: dto.vanId, deletedAt: null } });
      if (!van) {
        throw new BadRequestException({ code: 'INVALID_VAN', message: `Van ${dto.vanId} not found` });
      }

      const productIds = dto.items.map((i) => i.productId);
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
      });
      const productMap = new Map(products.map((p) => [p.id, p]));
      for (const it of dto.items) {
        if (!productMap.has(it.productId)) {
          throw new BadRequestException({
            code: 'INVALID_PRODUCT',
            message: `Product ${it.productId} not found`,
          });
        }
      }

      // van-side availability check: aggregate DISTRIBUTION_LINE remainingQuantity per product
      const vanAvailability = await tx.stockLotAllocation.groupBy({
        by: ['stockEntryId'],
        where: {
          consumerType: StockLotConsumerType.DISTRIBUTION_LINE,
          remainingQuantity: { gt: 0 },
          stockEntry: { productId: { in: productIds } },
          consumerId: {
            in: (
              await tx.distributionLine.findMany({
                where: { distribution: { vanId: dto.vanId, deletedAt: null } },
                select: { id: true },
              })
            ).map((l) => l.id),
          },
        },
        _sum: { remainingQuantity: true },
      });
      const stockEntries = await tx.stockEntry.findMany({
        where: { id: { in: vanAvailability.map((v) => v.stockEntryId) } },
        select: { id: true, productId: true },
      });
      const entryToProduct = new Map(stockEntries.map((s) => [s.id, s.productId]));
      const availableByProduct = new Map<string, number>();
      for (const row of vanAvailability) {
        const pid = entryToProduct.get(row.stockEntryId);
        if (!pid) continue;
        availableByProduct.set(pid, (availableByProduct.get(pid) ?? 0) + (row._sum.remainingQuantity ?? 0));
      }
      const insufficient: string[] = [];
      const requestedByProduct = new Map<string, number>();
      for (const it of dto.items) {
        requestedByProduct.set(it.productId, (requestedByProduct.get(it.productId) ?? 0) + it.qty);
      }
      for (const [pid, qty] of requestedByProduct) {
        if ((availableByProduct.get(pid) ?? 0) < qty) insufficient.push(pid);
      }
      if (insufficient.length) throw new InsufficientStockException(insufficient);

      const total = dto.items.reduce((s, i) => s + i.price * i.qty, 0);
      const invoiceId = await this.ids.next('INV', 4, tx);
      const saleId = await this.ids.next('SAL', 3, tx);

      const [invoice, sale] = await Promise.all([
        tx.invoice.create({
          data: {
            id: invoiceId,
            vanId: dto.vanId,
            date,
            total,
            status: InvoiceStatus.unpaid,
            items: {
              create: dto.items.map((it) => {
                const p = productMap.get(it.productId)!;
                return {
                  productId: it.productId,
                  name: p.name,
                  price: it.price,
                  qty: it.qty,
                  subtotal: it.price * it.qty,
                };
              }),
            },
          },
          include: { items: true },
        }),
        tx.sale.create({
          data: {
            id: saleId,
            vanId: dto.vanId,
            date,
            total,
            invoiceId,
            items: {
              create: dto.items.map((it) => ({
                productId: it.productId,
                price: it.price,
                qty: it.qty,
              })),
            },
          },
          include: { items: true },
        }),
      ]);

      // FIFO-consume van lots per sale item — allocate in parallel, batch insert
      const allocatedPerItem = await Promise.all(
        sale.items.map((saleItem) =>
          this.lots
            .allocateFromVan(tx, dto.vanId, saleItem.productId, saleItem.qty)
            .then((slices) => ({ saleItem, slices })),
        ),
      );
      const saleAllocationRows = allocatedPerItem.flatMap(({ saleItem, slices }) =>
        slices.map((s) => ({
          stockEntryId: s.stockEntryId,
          parentAllocationId: s.parentAllocationId,
          consumerType: StockLotConsumerType.SALE_ITEM,
          consumerId: saleItem.id,
          quantity: s.quantity,
          unitCost: s.unitCost,
        })),
      );
      const cogs = saleAllocationRows.reduce((sum, r) => sum + r.quantity * r.unitCost, 0);

      const uniqueProductIds = Array.from(new Set(sale.items.map((i) => i.productId)));
      await Promise.all([
        saleAllocationRows.length
          ? tx.stockLotAllocation.createMany({ data: saleAllocationRows })
          : Promise.resolve(),
        tx.transaction.create({
          data: {
            occurredAt: new Date(),
            amount: total,
            type: TransactionType.sale,
            description: `Sale on ${van.vanName} (${dto.items.length} items)`,
            refTable: 'invoices',
            refId: invoice.id,
          },
        }),
      ]);
      await Promise.all(
        uniqueProductIds.map((pid) => this.lots.recomputeProductStock(tx, pid)),
      );

      await tx.auditLog.create({
        data: {
          action: AuditAction.CREATE,
          entity: 'Sale',
          entityId: sale.id,
          after: sale as unknown as Prisma.InputJsonValue,
          meta: {
            vanId: dto.vanId,
            date: dto.date,
            invoiceId: invoice.id,
            total,
            cogs,
            items: sale.items.map((i) => ({
              productId: i.productId,
              qty: i.qty,
              price: i.price,
            })),
          } as unknown as Prisma.InputJsonValue,
        },
      });

      const shaped = this.shapeInvoice({
        id: invoice.id,
        date: invoice.date,
        vanId: invoice.vanId,
        van: { vanName: van.vanName },
        total: invoice.total,
        status: invoice.status,
        items: invoice.items,
      });
      return { ...shaped, cogs, profit: total - cogs };
    },
      { timeout: 20000, maxWait: 5000 },
    );
  }

  async findAll(q: ListSalesQueryDto): Promise<ListResponse<unknown>> {
    const where: Prisma.SaleWhereInput = {
      deletedAt: null,
      ...(q.vanId ? { vanId: q.vanId } : {}),
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
              { invoiceId: { contains: q.q.toUpperCase() } },
              { van: { vanName: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const orderBy = q.parseSort(['date', 'createdAt', 'total']) ?? { createdAt: 'desc' };
    const [items, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy,
        skip: q.skip,
        take: q.take,
        include: {
          van: { select: { vanName: true } },
          items: true,
          invoice: { select: { id: true, status: true, total: true } },
        },
      }),
      this.prisma.sale.count({ where }),
    ]);
    return listResponse(items, total, q);
  }

  async findOne(id: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id, deletedAt: null },
      include: {
        van: true,
        items: { include: { product: { select: { name: true, unit: true } } } },
        invoice: { include: { items: true } },
      },
    });
    if (!sale) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Sale ${id} not found` });
    }
    return sale;
  }

  /**
   * Void a sale: reverses FIFO allocations (returns stock to van), soft-deletes
   * sale + linked invoice, writes a reversing transaction. Blocked when invoice
   * is already paid (cashbox locked).
   */
  async void(id: string) {
    const productIds = await this.prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findFirst({
          where: { id, deletedAt: null },
          include: { items: true, invoice: true },
        });
        if (!sale) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: `Sale ${id} not found` });
        }
        if (sale.invoice?.status === InvoiceStatus.paid) {
          throw new ConflictException({
            code: 'INVOICE_LOCKED',
            message: 'Cannot void sale: invoice is already paid',
            fields: { invoiceId: sale.invoiceId },
          });
        }

        // reverse SALE_ITEM allocations — restores qty to parent DISTRIBUTION_LINE
        // (van) or to StockEntry (warehouse fallback if no parent).
        for (const item of sale.items) {
          await this.lots.reverseAllocationsFor(
            tx,
            StockLotConsumerType.SALE_ITEM,
            item.id,
          );
        }

        if (sale.invoiceId) {
          await tx.invoice.update({
            where: { id: sale.invoiceId },
            data: { deletedAt: new Date() },
          });
        }
        await tx.sale.update({
          where: { id: sale.id },
          data: { deletedAt: new Date() },
        });

        await Promise.all([
          tx.transaction.create({
            data: {
              occurredAt: new Date(),
              amount: -sale.total,
              type: TransactionType.sale,
              description: `Sale voided: ${sale.id} (${sale.items.length} items)`,
              refTable: 'sales',
              refId: sale.id,
            },
          }),
          tx.auditLog.create({
            data: {
              action: AuditAction.DELETE,
              entity: 'Sale',
              entityId: sale.id,
              before: sale as unknown as Prisma.InputJsonValue,
            },
          }),
        ]);

        const uniquePids = Array.from(new Set(sale.items.map((i) => i.productId)));
        await Promise.all(uniquePids.map((pid) => this.lots.recomputeProductStock(tx, pid)));
        return uniquePids;
      },
      { timeout: 20000, maxWait: 5000 },
    );
    return { id, voided: true, productsAffected: productIds.length };
  }

  async lastForVan(vanId: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { vanId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        invoice: { include: { van: true, items: true } },
        items: { include: { product: { select: { name: true, unit: true } } } },
      },
    });
    if (!sale) throw new NotFoundException({ code: 'NOT_FOUND', message: 'No sales recorded for van' });
    return sale;
  }

  private shapeInvoice(inv: {
    id: string;
    date: Date;
    vanId: string;
    van: { vanName: string };
    total: number;
    status: InvoiceStatus;
    items: { id: string }[];
  }) {
    return {
      id: inv.id,
      date: inv.date.toISOString().slice(0, 10),
      van: inv.van.vanName,
      vanId: inv.vanId,
      items: inv.items.length,
      total: inv.total,
      status: inv.status,
    };
  }
}
