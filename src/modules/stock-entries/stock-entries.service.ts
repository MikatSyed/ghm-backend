import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockLotConsumerType, TransactionType } from '@prisma/client';
import { listResponse, ListResponse } from '../../common/dto/pagination.dto';
import { parseDhakaDateOnly } from '../../common/util/dhaka-time';
import { PrefixIdService } from '../../common/services/prefix-id.service';
import { StockLotService } from '../../common/services/stock-lot.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStockEntryDto } from './dto/create-stock-entry.dto';
import { ListStockEntriesQueryDto } from './dto/list-stock-entries.query';

@Injectable()
export class StockEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: PrefixIdService,
    private readonly lots: StockLotService,
  ) {}

  async create(dto: CreateStockEntryDto) {
    const date = parseDhakaDateOnly(dto.date);
    const expiryDate = dto.expiryDate ? parseDhakaDateOnly(dto.expiryDate) : null;
    return this.prisma.$transaction(
      async (tx) => {
      const product = await tx.product.findFirst({ where: { id: dto.productId, deletedAt: null } });
      if (!product) {
        throw new BadRequestException({
          code: 'INVALID_PRODUCT',
          message: `Product ${dto.productId} not found`,
          fields: { productId: 'unknown' },
        });
      }
      const id = await this.ids.next('STK', 3, tx);
      const entry = await tx.stockEntry.create({
        data: {
          id,
          date,
          productId: dto.productId,
          quantity: dto.quantity,
          remainingQuantity: dto.quantity,
          expiryDate,
          buyingRate: dto.buyingRate,
          source: dto.source,
          notes: dto.notes,
        },
      });
      await this.lots.recomputeProductStock(tx, dto.productId);
      await tx.transaction.create({
        data: {
          occurredAt: new Date(),
          amount: dto.quantity * dto.buyingRate,
          type: TransactionType.stock,
          description: `Stock in: ${product.name} +${dto.quantity} ${product.unit} from ${dto.source}`,
          refTable: 'stock_entries',
          refId: entry.id,
        },
      });
      return entry;
    },
      { timeout: 20000, maxWait: 5000 },
    );
  }

  async findAll(q: ListStockEntriesQueryDto): Promise<ListResponse<unknown>> {
    const where: Prisma.StockEntryWhereInput = {
      deletedAt: null,
      ...(q.productId ? { productId: q.productId } : {}),
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
              { source: { contains: q.q, mode: 'insensitive' } },
              { product: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const orderBy = q.parseSort(['date', 'createdAt', 'quantity']) ?? { date: 'desc' };
    const [items, total] = await Promise.all([
      this.prisma.stockEntry.findMany({
        where,
        orderBy,
        skip: q.skip,
        take: q.take,
        include: { product: { select: { name: true, unit: true } } },
      }),
      this.prisma.stockEntry.count({ where }),
    ]);
    return listResponse(items, total, q);
  }

  async findOne(id: string) {
    const e = await this.prisma.stockEntry.findFirst({
      where: { id, deletedAt: null },
      include: {
        product: true,
        allocations: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!e) throw new NotFoundException({ code: 'NOT_FOUND', message: `Stock entry ${id} not found` });
    return e;
  }

  async remove(id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const entry = await tx.stockEntry.findFirst({
          where: { id, deletedAt: null },
          select: { id: true, productId: true },
        });
        if (!entry) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: `Stock entry ${id} not found`,
          });
        }

        const allocs = await tx.stockLotAllocation.findMany({
          where: { stockEntryId: id },
          select: { consumerType: true, consumerId: true },
        });

        // Distribution lines and sale items represent operational/financial
        // events whose cost basis is anchored to this lot. Cascading those is
        // unsafe — block instead so the user undoes the sale/distribution
        // first.
        const distCount = allocs.filter(
          (a) => a.consumerType === StockLotConsumerType.DISTRIBUTION_LINE,
        ).length;
        const saleCount = allocs.filter(
          (a) => a.consumerType === StockLotConsumerType.SALE_ITEM,
        ).length;
        if (distCount > 0 || saleCount > 0) {
          throw new ConflictException({
            code: 'IN_USE',
            message:
              'Stock entry has been consumed by downstream records and cannot be deleted',
            fields: {
              distributionLines: distCount,
              saleItems: saleCount,
              stockAdjustments: 0,
            },
          });
        }

        // Cascade-soft-delete every adjustment that allocated against this
        // lot. reverseAllocationsFor returns the consumed units (across all
        // lots, not just this one) back to their source stock entries, so
        // we recompute stock for every product touched.
        const adjIds = Array.from(
          new Set(
            allocs
              .filter((a) => a.consumerType === StockLotConsumerType.STOCK_ADJUSTMENT)
              .map((a) => a.consumerId),
          ),
        );
        const affectedProductIds = new Set<string>([entry.productId]);
        for (const adjId of adjIds) {
          const adj = await tx.stockAdjustment.findUnique({
            where: { id: adjId },
            select: { id: true, productId: true, deletedAt: true },
          });
          if (!adj || adj.deletedAt) continue;
          affectedProductIds.add(adj.productId);
          await this.lots.reverseAllocationsFor(
            tx,
            StockLotConsumerType.STOCK_ADJUSTMENT,
            adjId,
          );
          await tx.stockAdjustment.update({
            where: { id: adjId },
            data: { deletedAt: new Date() },
          });
        }

        await tx.stockEntry.update({
          where: { id },
          data: { deletedAt: new Date() },
        });

        for (const pid of affectedProductIds) {
          await this.lots.recomputeProductStock(tx, pid);
        }

        return { id, deleted: true, cascadedAdjustments: adjIds.length };
      },
      { timeout: 20000, maxWait: 5000 },
    );
  }
}
