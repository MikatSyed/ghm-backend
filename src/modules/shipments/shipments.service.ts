import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, TransactionType } from '@prisma/client';
import { PrefixIdService } from '../../common/services/prefix-id.service';
import { StockLotService } from '../../common/services/stock-lot.service';
import { parseDhakaDateOnly } from '../../common/util/dhaka-time';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: PrefixIdService,
    private readonly lots: StockLotService,
  ) {}

  async create(dto: CreateShipmentDto) {
    const date = parseDhakaDateOnly(dto.date);
    const transportCost = dto.transportCost;
    const labourCost = dto.labourCost;
    const otherCost = dto.otherCost ?? 0;
    const totalOverhead = transportCost + labourCost + otherCost;

    const totalQty = dto.items.reduce((sum, item) => sum + item.quantity, 0);
    if (totalQty <= 0) {
      throw new BadRequestException('Total quantity must be greater than 0');
    }

    // Validate bank account if provided
    if (dto.bankAccountId) {
      const bank = await this.prisma.bankAccount.findFirst({
        where: { id: dto.bankAccountId, deletedAt: null },
      });
      if (!bank) {
        throw new BadRequestException(`Bank account ${dto.bankAccountId} not found`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const shipmentId = await this.ids.next('SHP', 3, tx);
      let totalPurchaseAmount = 0;

      const shipment = await tx.shipment.create({
        data: {
          id: shipmentId,
          date,
          transportCost,
          labourCost,
          otherCost,
          source: dto.source,
          notes: dto.notes,
          bankAccountId: dto.bankAccountId,
          status: 'confirmed',
        },
      });

      for (const item of dto.items) {
        // Calculate shares of overheads based on quantity
        const itemTransportShare = Math.round(transportCost * (item.quantity / totalQty));
        const itemLabourShare = Math.round(labourCost * (item.quantity / totalQty));
        const itemOtherShare = Math.round(otherCost * (item.quantity / totalQty));

        const itemTotalCost = (item.basePrice * item.quantity) + itemTransportShare + itemLabourShare + itemOtherShare;
        const effectiveBuyPrice = Math.round(itemTotalCost / item.quantity);

        let sellPrice = item.sellPrice ?? 0;
        let profitPercent = item.profitPercent;

        // Auto-calculate sell price if profit percent is provided
        if (profitPercent !== undefined && !item.sellPrice) {
          sellPrice = Math.round(effectiveBuyPrice * (1 + profitPercent / 100));
        }
        // Auto-calculate profit percent if sell price is provided
        if (item.sellPrice && profitPercent === undefined) {
          profitPercent = Math.round(((item.sellPrice - effectiveBuyPrice) / effectiveBuyPrice) * 100);
        }

        const purchaseId = await this.ids.next('PUR', 3, tx);
        const purchase = await tx.purchase.create({
          data: {
            id: purchaseId,
            shipmentId,
            date,
            productId: item.productId,
            quantity: item.quantity,
            basePrice: item.basePrice,
            transportCost: itemTransportShare,
            labourCost: itemLabourShare,
            otherCost: itemOtherShare,
            effectiveBuyPrice,
            sellPrice,
            profitPercent,
            source: dto.source,
            notes: item.notes,
            status: 'confirmed',
          },
        });

        // Create Stock Entry
        const stockId = await this.ids.next('STK', 3, tx);
        await tx.stockEntry.create({
          data: {
            id: stockId,
            date,
            productId: item.productId,
            quantity: item.quantity,
            remainingQuantity: item.quantity,
            buyingRate: effectiveBuyPrice,
            source: `Shipment: ${shipmentId}`,
            notes: item.notes,
          },
        });

        // Update Product prices
        await tx.product.update({
          where: { id: item.productId },
          data: {
            buyPrice: effectiveBuyPrice,
            ...(sellPrice > 0 ? { sellPrice } : {}),
          },
        });

        // Recompute stock total for the product
        await this.lots.recomputeProductStock(tx, item.productId);

        totalPurchaseAmount += (item.basePrice * item.quantity);
      }

      const grandTotal = totalPurchaseAmount + totalOverhead;

      // Update shipment with totalAmount
      await tx.shipment.update({
        where: { id: shipmentId },
        data: { totalAmount: grandTotal },
      });

      // Bank deduction
      if (dto.bankAccountId) {
        await tx.bankAccount.update({
          where: { id: dto.bankAccountId },
          data: { balance: { decrement: grandTotal } },
        });
        await tx.bankTransaction.create({
          data: {
            bankAccountId: dto.bankAccountId,
            type: 'withdrawal',
            amount: grandTotal,
            description: `Shipment: ${shipmentId} from ${dto.source}`,
            reference: shipmentId,
            occurredAt: date,
          },
        });
      }

      // Activity feed transaction
      await tx.transaction.create({
        data: {
          occurredAt: date,
          amount: grandTotal,
          type: TransactionType.purchase,
          description: `Shipment: ${shipmentId} with ${dto.items.length} items from ${dto.source}`,
          refTable: 'shipments',
          refId: shipmentId,
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          action: AuditAction.CREATE,
          entity: 'Shipment',
          entityId: shipmentId,
          after: shipment as unknown as Prisma.InputJsonValue,
        },
      });

      return { shipmentId, totalAmount: grandTotal };
    });
  }

  async findAll() {
    return this.prisma.shipment.findMany({
      where: { deletedAt: null },
      include: {
        purchases: {
          include: {
            product: { select: { name: true, unit: true } },
          },
        },
        bankAccount: { select: { bankName: true, accountNumber: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  async findOne(id: string) {
    const s = await this.prisma.shipment.findFirst({
      where: { id, deletedAt: null },
      include: {
        purchases: {
          include: {
            product: { select: { name: true, unit: true, category: { select: { name: true } } } },
          },
        },
        bankAccount: true,
      },
    });
    if (!s) throw new NotFoundException(`Shipment ${id} not found`);
    return s;
  }
}
