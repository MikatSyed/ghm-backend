import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockCondition, StockLotConsumerType, TransactionType } from '@prisma/client';
import { listResponse, ListResponse } from '../../common/dto/pagination.dto';
import { parseDhakaDateOnly } from '../../common/util/dhaka-time';
import { PrefixIdService } from '../../common/services/prefix-id.service';
import { StockLotService } from '../../common/services/stock-lot.service';
import { PricingService } from '../../common/services/pricing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStockBatchDto } from './dto/create-stock-batch.dto';
import { ListStockBatchesQueryDto } from './dto/list-stock-batches.query';

@Injectable()
export class StockBatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: PrefixIdService,
    private readonly lots: StockLotService,
    private readonly pricing: PricingService,
  ) {}

  async create(dto: CreateStockBatchDto) {
    const date = parseDhakaDateOnly(dto.date);
    return this.prisma.$transaction(
      async (tx) => {
        const productIds = Array.from(new Set(dto.lines.map((l) => l.productId)));
        const products = await tx.product.findMany({
          where: { id: { in: productIds }, deletedAt: null },
          select: { id: true, name: true, unit: true },
        });
        if (products.length !== productIds.length) {
          const found = new Set(products.map((p) => p.id));
          const missing = productIds.filter((id) => !found.has(id));
          throw new BadRequestException({
            code: 'INVALID_PRODUCT',
            message: `Unknown product(s): ${missing.join(', ')}`,
            fields: { productId: missing },
          });
        }
        const productMap = new Map(products.map((p) => [p.id, p]));

        const batchId = await this.ids.next('BAT', 3, tx);
        const batch = await tx.stockBatch.create({
          data: {
            id: batchId,
            date,
            source: dto.source,
            notes: dto.notes,
          },
        });

        for (const line of dto.lines) {
          const product = productMap.get(line.productId)!;
          const expiryDate = line.expiryDate ? parseDhakaDateOnly(line.expiryDate) : null;

          const ladder = this.pricing.computeLadder(
            line.basePrice,
            {
              taxPercent: line.listTaxPercent,
              profitPercent: line.listProfitPercent,
              othersPercent: line.listOthersPercent,
              price: line.listPrice,
            },
            {
              taxPercent: line.tradeTaxPercent,
              profitPercent: line.tradeProfitPercent,
              othersPercent: line.tradeOthersPercent,
              price: line.tradePrice,
            },
            {
              taxPercent: line.mrpTaxPercent,
              profitPercent: line.mrpProfitPercent,
              othersPercent: line.mrpOthersPercent,
              price: line.mrp,
            },
          );

          const entryId = await this.ids.next('STK', 3, tx);
          const entry = await tx.stockEntry.create({
            data: {
              id: entryId,
              date,
              productId: line.productId,
              batchId,
              quantity: line.quantity,
              remainingQuantity: line.quantity,
              expiryDate,
              basePrice: ladder.basePrice,
              listPrice: ladder.listPrice,
              tradePrice: ladder.tradePrice,
              mrp: ladder.mrp,
              listTaxPercent: ladder.listTaxPercent,
              listProfitPercent: ladder.listProfitPercent,
              listOthersPercent: ladder.listOthersPercent,
              tradeTaxPercent: ladder.tradeTaxPercent,
              tradeProfitPercent: ladder.tradeProfitPercent,
              tradeOthersPercent: ladder.tradeOthersPercent,
              mrpTaxPercent: ladder.mrpTaxPercent,
              mrpProfitPercent: ladder.mrpProfitPercent,
              mrpOthersPercent: ladder.mrpOthersPercent,
              condition: line.condition ?? 'FRESH',
              source: dto.source,
              notes: line.notes,
            },
          });
          await tx.transaction.create({
            data: {
              occurredAt: new Date(),
              amount: line.quantity * ladder.basePrice,
              type: TransactionType.stock,
              description: `Batch ${batchId}: +${line.quantity} ${product.unit} ${product.name} from ${dto.source}`,
              refTable: 'stock_entries',
              refId: entry.id,
            },
          });

          // Keep Product's price book current — only FRESH lots should set the
          // reference price; a damaged/aging discount must not poison it.
          if ((line.condition ?? StockCondition.FRESH) === StockCondition.FRESH) {
            await tx.product.update({
              where: { id: line.productId },
              data: {
                basePrice: ladder.basePrice,
                listPrice: ladder.listPrice,
                tradePrice: ladder.tradePrice,
                mrp: ladder.mrp,
                listTaxPercent: ladder.listTaxPercent,
                listProfitPercent: ladder.listProfitPercent,
                listOthersPercent: ladder.listOthersPercent,
                tradeTaxPercent: ladder.tradeTaxPercent,
                tradeProfitPercent: ladder.tradeProfitPercent,
                tradeOthersPercent: ladder.tradeOthersPercent,
                mrpTaxPercent: ladder.mrpTaxPercent,
                mrpProfitPercent: ladder.mrpProfitPercent,
                mrpOthersPercent: ladder.mrpOthersPercent,
              },
            });
          }
        }

        for (const pid of productIds) {
          await this.lots.recomputeProductStock(tx, pid);
        }

        return tx.stockBatch.findUnique({
          where: { id: batch.id },
          include: {
            entries: {
              include: { product: { select: { name: true, unit: true } } },
            },
          },
        });
      },
      { timeout: 30000, maxWait: 5000 },
    );
  }

  async findAll(q: ListStockBatchesQueryDto): Promise<ListResponse<unknown>> {
    const where: Prisma.StockBatchWhereInput = {
      deletedAt: null,
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
            ],
          }
        : {}),
    };
    const orderBy = q.parseSort(['date', 'createdAt']) ?? { date: 'desc' };
    const [items, total] = await Promise.all([
      this.prisma.stockBatch.findMany({
        where,
        orderBy,
        skip: q.skip,
        take: q.take,
        include: {
          entries: {
            where: { deletedAt: null },
            include: { product: { select: { name: true, unit: true } } },
          },
        },
      }),
      this.prisma.stockBatch.count({ where }),
    ]);
    return listResponse(items, total, q);
  }

  async findOne(id: string) {
    const batch = await this.prisma.stockBatch.findFirst({
      where: { id, deletedAt: null },
      include: {
        entries: {
          where: { deletedAt: null },
          include: { product: { select: { name: true, unit: true } } },
          orderBy: { createdAt: 'asc' },
        },
        purchases: {
          select: {
            id: true,
            total: true,
            bankAccountId: true,
            lines: {
              select: {
                productId: true,
                quantity: true,
                effectiveBuyPrice: true,
              },
            },
          },
        },
      },
    });
    if (!batch) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Stock batch ${id} not found`,
      });
    }
    return batch;
  }

  async remove(id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const batch = await tx.stockBatch.findFirst({
          where: { id, deletedAt: null },
          include: {
            entries: { select: { id: true, productId: true, deletedAt: true } },
          },
        });
        if (!batch) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: `Stock batch ${id} not found`,
          });
        }

        const liveEntries = batch.entries.filter((e) => !e.deletedAt);
        const entryIds = liveEntries.map((e) => e.id);
        const allocs = await tx.stockLotAllocation.findMany({
          where: { stockEntryId: { in: entryIds } },
          select: { consumerType: true },
        });
        const blockers = allocs.filter(
          (a) =>
            a.consumerType === StockLotConsumerType.DISTRIBUTION_LINE ||
            a.consumerType === StockLotConsumerType.SALE_ITEM,
        );
        if (blockers.length > 0) {
          throw new ConflictException({
            code: 'IN_USE',
            message: 'Batch has entries consumed by downstream records and cannot be deleted',
          });
        }

        const affectedProducts = new Set(liveEntries.map((e) => e.productId));
        await tx.stockEntry.updateMany({
          where: { id: { in: entryIds } },
          data: { deletedAt: new Date() },
        });
        await tx.stockBatch.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        for (const pid of affectedProducts) {
          await this.lots.recomputeProductStock(tx, pid);
        }
        return { id, deleted: true };
      },
      { timeout: 20000, maxWait: 5000 },
    );
  }
}
