import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, StockCondition, TransactionType } from '@prisma/client';
import { listResponse, ListResponse } from '../../common/dto/pagination.dto';
import { parseDhakaDateOnly } from '../../common/util/dhaka-time';
import { PrefixIdService } from '../../common/services/prefix-id.service';
import { StockLotService } from '../../common/services/stock-lot.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePurchaseDto, PurchaseLineDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { ListPurchasesQueryDto } from './dto/list-purchases.query';

interface ComputedLine {
  productId: string;
  quantity: number;
  basePrice: number;
  transportCost: number;
  labourCost: number;
  otherCost: number;
  effectiveBuyPrice: number;
  sellPrice: number;
  profitPercent?: number;
  condition: StockCondition;
  lineTotal: number;
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: PrefixIdService,
    private readonly lots: StockLotService,
  ) {}

  /**
   * effectiveBuyPrice (cost per unit):
   *   (basePrice * qty + transport + labour + other) / qty, rounded.
   */
  private calcEffectiveBuyPrice(
    basePrice: number,
    qty: number,
    transportCost: number,
    labourCost: number,
    otherCost: number,
  ): number {
    const totalCost = basePrice * qty + transportCost + labourCost + otherCost;
    return Math.round(totalCost / qty);
  }

  private calcSellPrice(effectiveBuyPrice: number, profitPercent: number): number {
    return Math.round(effectiveBuyPrice * (1 + profitPercent / 100));
  }

  private computeLine(line: PurchaseLineDto): ComputedLine {
    const transportCost = line.transportCost ?? 0;
    const labourCost = line.labourCost ?? 0;
    const otherCost = line.otherCost ?? 0;
    const effectiveBuyPrice = this.calcEffectiveBuyPrice(
      line.basePrice,
      line.quantity,
      transportCost,
      labourCost,
      otherCost,
    );

    let sellPrice = line.sellPrice ?? 0;
    let profitPercent = line.profitPercent;

    if (profitPercent !== undefined && !line.sellPrice) {
      sellPrice = this.calcSellPrice(effectiveBuyPrice, profitPercent);
    }
    if (line.sellPrice && profitPercent === undefined && effectiveBuyPrice > 0) {
      profitPercent = Math.round(((line.sellPrice - effectiveBuyPrice) / effectiveBuyPrice) * 100);
    }

    const lineTotal = line.basePrice * line.quantity + transportCost + labourCost + otherCost;

    return {
      productId: line.productId,
      quantity: line.quantity,
      basePrice: line.basePrice,
      transportCost,
      labourCost,
      otherCost,
      effectiveBuyPrice,
      sellPrice,
      profitPercent,
      condition: line.condition ?? StockCondition.FRESH,
      lineTotal,
    };
  }

  async create(dto: CreatePurchaseDto) {
    const date = parseDhakaDateOnly(dto.date);
    const computedLines = dto.lines.map((l) => this.computeLine(l));
    const total = computedLines.reduce((s, l) => s + l.lineTotal, 0);

    return this.prisma.$transaction(
      async (tx) => {
        // Validate every product exists
        const productIds = Array.from(new Set(computedLines.map((l) => l.productId)));
        const products = await tx.product.findMany({
          where: { id: { in: productIds }, deletedAt: null },
          select: { id: true, name: true, unit: true },
        });
        if (products.length !== productIds.length) {
          const known = new Set(products.map((p) => p.id));
          const missing = productIds.filter((id) => !known.has(id));
          throw new BadRequestException({
            code: 'INVALID_PRODUCT',
            message: `Unknown product(s): ${missing.join(', ')}`,
            fields: { productId: missing },
          });
        }
        const productMap = new Map(products.map((p) => [p.id, p]));

        const purchaseId = await this.ids.next('PUR', 3, tx);

        // One batch covers the whole purchase — multi-product receiving event.
        const batchId = await this.ids.next('BAT', 3, tx);
        await tx.stockBatch.create({
          data: {
            id: batchId,
            date,
            source: dto.source,
            notes: dto.notes,
          },
        });

        // Per line: stock entry + product price/stock update.
        // Only FRESH lines update Product.basePrice/tradePrice — a damaged
        // discount must not poison the global product price.
        for (const line of computedLines) {
          const product = productMap.get(line.productId)!;
          const stockEntryId = await this.ids.next('STK', 3, tx);
          await tx.stockEntry.create({
            data: {
              id: stockEntryId,
              date,
              productId: line.productId,
              batchId,
              quantity: line.quantity,
              remainingQuantity: line.quantity,
              basePrice: line.effectiveBuyPrice,
              tradePrice: line.sellPrice > 0 ? line.sellPrice : null,
              condition: line.condition,
              source: dto.source,
              notes: dto.notes,
            },
          });
          if (line.condition === StockCondition.FRESH) {
            await tx.product.update({
              where: { id: line.productId },
              data: {
                basePrice: line.effectiveBuyPrice,
                ...(line.sellPrice > 0 ? { tradePrice: line.sellPrice } : {}),
              },
            });
          }
          await this.lots.recomputeProductStock(tx, line.productId);
          await tx.transaction.create({
            data: {
              occurredAt: date,
              amount: line.lineTotal,
              type: TransactionType.purchase,
              description: `Purchase ${purchaseId}: ${product.name} x${line.quantity} ${product.unit} from ${dto.source}`,
              refTable: 'purchase_lines',
              refId: purchaseId,
            },
          });
        }

        const purchase = await tx.purchase.create({
          data: {
            id: purchaseId,
            date,
            source: dto.source,
            notes: dto.notes,
            bankAccountId: dto.bankAccountId,
            batchId,
            total,
            status: 'confirmed',
            lines: {
              create: computedLines.map((l) => ({
                productId: l.productId,
                quantity: l.quantity,
                basePrice: l.basePrice,
                transportCost: l.transportCost,
                labourCost: l.labourCost,
                otherCost: l.otherCost,
                effectiveBuyPrice: l.effectiveBuyPrice,
                sellPrice: l.sellPrice,
                profitPercent: l.profitPercent,
                condition: l.condition,
              })),
            },
          },
          include: {
            lines: { include: { product: { select: { name: true, unit: true } } } },
            bankAccount: true,
            batch: true,
          },
        });

        // Deduct bank in one shot for the full total. Re-fetch inside the tx so
        // concurrent purchases see each other; the bank_accounts.balance CHECK
        // constraint is the ultimate safety net against a lost-update race.
        if (dto.bankAccountId) {
          const bank = await tx.bankAccount.findFirst({
            where: { id: dto.bankAccountId, deletedAt: null },
            select: { balance: true },
          });
          if (!bank) {
            throw new BadRequestException({
              code: 'INVALID_BANK_ACCOUNT',
              message: `Bank account ${dto.bankAccountId} not found`,
            });
          }
          if (bank.balance < total) {
            throw new BadRequestException({
              code: 'INSUFFICIENT_BALANCE',
              message: `Insufficient balance. Current: ৳${bank.balance}, Requested: ৳${total}`,
              fields: { balance: bank.balance, requested: total },
            });
          }
          await tx.bankAccount.update({
            where: { id: dto.bankAccountId },
            data: { balance: { decrement: total } },
          });
          await tx.bankTransaction.create({
            data: {
              bankAccountId: dto.bankAccountId,
              type: 'withdrawal',
              amount: total,
              description: `Purchase ${purchaseId} (${computedLines.length} line${computedLines.length > 1 ? 's' : ''}) from ${dto.source}`,
              reference: purchaseId,
              occurredAt: date,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            action: AuditAction.CREATE,
            entity: 'Purchase',
            entityId: purchaseId,
            after: purchase as unknown as Prisma.InputJsonValue,
          },
        });

        return purchase;
      },
      { timeout: 60000, maxWait: 8000 },
    );
  }

  async findAll(q: ListPurchasesQueryDto): Promise<ListResponse<unknown>> {
    const where: Prisma.PurchaseWhereInput = {
      deletedAt: null,
      ...(q.productId ? { lines: { some: { productId: q.productId } } } : {}),
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
              { lines: { some: { product: { name: { contains: q.q, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };

    const orderBy = q.parseSort(['date', 'createdAt', 'total']) ?? { date: 'desc' };
    const [items, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        orderBy,
        skip: q.skip,
        take: q.take,
        include: {
          lines: { include: { product: { select: { name: true, unit: true } } } },
          bankAccount: { select: { bankName: true, accountNumber: true } },
          batch: { select: { id: true, date: true } },
        },
      }),
      this.prisma.purchase.count({ where }),
    ]);
    return listResponse(items, total, q);
  }

  async findOne(id: string) {
    const p = await this.prisma.purchase.findFirst({
      where: { id, deletedAt: null },
      include: {
        lines: {
          include: {
            product: { select: { name: true, unit: true, category: { select: { name: true } } } },
          },
        },
        bankAccount: true,
        batch: true,
      },
    });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: `Purchase ${id} not found` });
    return p;
  }

  async update(id: string, dto: UpdatePurchaseDto) {
    const existing = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchase.update({
        where: { id },
        data: {
          ...(dto.date ? { date: parseDhakaDateOnly(dto.date) } : {}),
          ...(dto.source ? { source: dto.source } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.bankAccountId !== undefined ? { bankAccountId: dto.bankAccountId } : {}),
        },
        include: {
          lines: { include: { product: { select: { name: true, unit: true } } } },
        },
      });

      await tx.auditLog.create({
        data: {
          action: AuditAction.UPDATE,
          entity: 'Purchase',
          entityId: id,
          before: existing as unknown as Prisma.InputJsonValue,
          after: updated as unknown as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.purchase.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          action: AuditAction.DELETE,
          entity: 'Purchase',
          entityId: id,
          before: existing as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }
}
