import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma, TransactionType } from '@prisma/client';
import { listResponse, ListResponse } from '../../common/dto/pagination.dto';
import { parseDhakaDateOnly } from '../../common/util/dhaka-time';
import { PrefixIdService } from '../../common/services/prefix-id.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { ListPurchasesQueryDto } from './dto/list-purchases.query';

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: PrefixIdService,
  ) {}

  /**
   * Calculate effectiveBuyPrice (cost per unit):
   *   (basePrice * qty + transportCost + labourCost + otherCost) / qty
   * Rounded to nearest integer.
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

  /**
   * Calculate sell price from effective buy price + profit percent.
   */
  private calcSellPrice(effectiveBuyPrice: number, profitPercent: number): number {
    return Math.round(effectiveBuyPrice * (1 + profitPercent / 100));
  }

  async create(dto: CreatePurchaseDto) {
    const date = parseDhakaDateOnly(dto.date);
    const transportCost = dto.transportCost ?? 0;
    const labourCost = dto.labourCost ?? 0;
    const otherCost = dto.otherCost ?? 0;

    const effectiveBuyPrice = this.calcEffectiveBuyPrice(
      dto.basePrice,
      dto.quantity,
      transportCost,
      labourCost,
      otherCost,
    );

    let sellPrice = dto.sellPrice ?? 0;
    let profitPercent = dto.profitPercent;

    // If profitPercent is given but sellPrice isn't, auto-calculate sell price
    if (profitPercent !== undefined && !dto.sellPrice) {
      sellPrice = this.calcSellPrice(effectiveBuyPrice, profitPercent);
    }
    // If sellPrice is given without profitPercent, compute it for record
    if (dto.sellPrice && profitPercent === undefined) {
      profitPercent = Math.round(((dto.sellPrice - effectiveBuyPrice) / effectiveBuyPrice) * 100);
    }

    // Validate bank account if provided
    if (dto.bankAccountId) {
      const bank = await this.prisma.bankAccount.findFirst({
        where: { id: dto.bankAccountId, deletedAt: null },
      });
      if (!bank) {
        throw new BadRequestException({
          code: 'INVALID_BANK_ACCOUNT',
          message: `Bank account ${dto.bankAccountId} not found`,
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Validate product
      const product = await tx.product.findFirst({
        where: { id: dto.productId, deletedAt: null },
      });
      if (!product) {
        throw new BadRequestException({
          code: 'INVALID_PRODUCT',
          message: `Product ${dto.productId} not found`,
        });
      }

      const id = await this.ids.next('PUR', 3, tx);
      const purchase = await tx.purchase.create({
        data: {
          id,
          date,
          productId: dto.productId,
          quantity: dto.quantity,
          basePrice: dto.basePrice,
          transportCost,
          labourCost,
          otherCost,
          effectiveBuyPrice,
          sellPrice,
          profitPercent,
          source: dto.source,
          notes: dto.notes,
          bankAccountId: dto.bankAccountId,
          status: 'confirmed',
        },
        include: { product: { select: { name: true, unit: true } }, bankAccount: true },
      });

      // Update product's buyPrice and sellPrice from this purchase
      await tx.product.update({
        where: { id: dto.productId },
        data: {
          buyPrice: effectiveBuyPrice,
          ...(sellPrice > 0 ? { sellPrice } : {}),
        },
      });

      // Deduct from bank account if provided
      const totalPurchaseAmount = dto.basePrice * dto.quantity + transportCost + labourCost + otherCost;
      if (dto.bankAccountId) {
        await tx.bankAccount.update({
          where: { id: dto.bankAccountId },
          data: { balance: { decrement: totalPurchaseAmount } },
        });
        await tx.bankTransaction.create({
          data: {
            bankAccountId: dto.bankAccountId,
            type: 'withdrawal',
            amount: totalPurchaseAmount,
            description: `Purchase: ${product.name} x${dto.quantity} ${product.unit} (${id})`,
            reference: id,
            occurredAt: date,
          },
        });
      }

      // Create a Transaction record for activity feed
      await tx.transaction.create({
        data: {
          occurredAt: date,
          amount: totalPurchaseAmount,
          type: TransactionType.purchase,
          description: `Purchase: ${product.name} x${dto.quantity} ${product.unit} from ${dto.source}`,
          refTable: 'purchases',
          refId: id,
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          action: AuditAction.CREATE,
          entity: 'Purchase',
          entityId: id,
          after: purchase as unknown as Prisma.InputJsonValue,
        },
      });

      return purchase;
    });
  }

  async findAll(q: ListPurchasesQueryDto): Promise<ListResponse<unknown>> {
    const where: Prisma.PurchaseWhereInput = {
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
      this.prisma.purchase.findMany({
        where,
        orderBy,
        skip: q.skip,
        take: q.take,
        include: {
          product: { select: { name: true, unit: true } },
          bankAccount: { select: { bankName: true, accountNumber: true } },
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
        product: { select: { name: true, unit: true, category: { select: { name: true } } } },
        bankAccount: true,
      },
    });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: `Purchase ${id} not found` });
    return p;
  }

  async update(id: string, dto: UpdatePurchaseDto) {
    const existing = await this.findOne(id);

    const quantity = dto.quantity ?? existing.quantity;
    const basePrice = dto.basePrice ?? existing.basePrice;
    const transportCost = dto.transportCost ?? existing.transportCost;
    const labourCost = dto.labourCost ?? existing.labourCost;
    const otherCost = dto.otherCost ?? existing.otherCost;

    const effectiveBuyPrice = this.calcEffectiveBuyPrice(
      basePrice, quantity, transportCost, labourCost, otherCost,
    );

    let sellPrice = dto.sellPrice ?? existing.sellPrice;
    let profitPercent = dto.profitPercent;

    if (profitPercent !== undefined && !dto.sellPrice) {
      sellPrice = this.calcSellPrice(effectiveBuyPrice, profitPercent);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchase.update({
        where: { id },
        data: {
          ...(dto.date ? { date: parseDhakaDateOnly(dto.date) } : {}),
          quantity,
          basePrice,
          transportCost,
          labourCost,
          otherCost,
          effectiveBuyPrice,
          sellPrice,
          profitPercent,
          ...(dto.source ? { source: dto.source } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.bankAccountId !== undefined ? { bankAccountId: dto.bankAccountId } : {}),
        },
        include: { product: { select: { name: true, unit: true } } },
      });

      // Update product prices from this purchase
      await tx.product.update({
        where: { id: existing.productId },
        data: {
          buyPrice: effectiveBuyPrice,
          ...(sellPrice > 0 ? { sellPrice } : {}),
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
