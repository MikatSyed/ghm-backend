import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma, StockLocation, StockLotConsumerType } from '@prisma/client';
import {
  dhakaDayBoundsUtc,
  dhakaTodayDateOnly,
  parseDhakaDateOnly,
} from '../../common/util/dhaka-time';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVanDto } from './dto/create-van.dto';
import { UpdateVanDto } from './dto/update-van.dto';

export interface VanStockSummaryProduct {
  productId: string;
  name: string | null;
  unit: string | null;
  allocated: number;
  returned: number;
  sold: number;
  damaged: number;
  available: number;
  soldRevenue: number;
  soldCost: number;
  profit: number;
  profitMargin: number;
  unitPrice: number | null;
  // true when today's van allocation for this product was drawn from a
  // DAMAGED (salvage) lot — the frontend must not fall back to full price.
  isDamagedStock: boolean;
}

export interface VanStockSummary {
  vanId: string;
  date: string;
  van: { vanName: string; driver: string };
  distributionId: string | null;
  products: VanStockSummaryProduct[];
  reconciliation: {
    isBalanced: boolean;
    discrepancies: Array<{
      productId: string;
      name: string | null;
      available: number;
      reason: string;
    }>;
  };
}

@Injectable()
export class VansService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const { startUtc, endUtc } = dhakaDayBoundsUtc();
    const dayDate = dhakaTodayDateOnly();
    const [vans, salesByVan, distroByVan] = await Promise.all([
      this.prisma.van.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' } }),
      this.prisma.invoice.groupBy({
        by: ['vanId'],
        where: { deletedAt: null, createdAt: { gte: startUtc, lt: endUtc } },
        _sum: { total: true },
      }),
      this.prisma.distributionLine.groupBy({
        by: ['distributionId'],
        where: { distribution: { date: dayDate } },
        _sum: { allocated: true, returned: true },
      }),
    ]);
    const distroIds = distroByVan.map((d) => d.distributionId);
    const distros = distroIds.length
      ? await this.prisma.distribution.findMany({
          where: { id: { in: distroIds } },
          select: { id: true, vanId: true },
        })
      : [];
    const distroIdToVan = new Map(distros.map((d) => [d.id, d.vanId]));
    const distAgg = new Map<string, { allocated: number; returned: number }>();
    for (const row of distroByVan) {
      const vid = distroIdToVan.get(row.distributionId);
      if (!vid) continue;
      const cur = distAgg.get(vid) ?? { allocated: 0, returned: 0 };
      cur.allocated += row._sum.allocated ?? 0;
      cur.returned += row._sum.returned ?? 0;
      distAgg.set(vid, cur);
    }
    const salesMap = new Map(salesByVan.map((s) => [s.vanId, s._sum.total ?? 0]));
    return vans.map((v) => ({
      vanId: v.id,
      vanName: v.vanName,
      driver: v.driver,
      sales: salesMap.get(v.id) ?? 0,
      distributed: distAgg.get(v.id)?.allocated ?? 0,
      returned: distAgg.get(v.id)?.returned ?? 0,
    }));
  }

  async findOne(id: string) {
    const v = await this.prisma.van.findFirst({ where: { id, deletedAt: null } });
    if (!v) throw new NotFoundException({ code: 'NOT_FOUND', message: `Van ${id} not found` });
    const summary = await this.todaySummary(id);
    return { vanId: v.id, vanName: v.vanName, driver: v.driver, ...summary };
  }

  async create(dto: CreateVanDto) {
    return this.prisma.van.create({ data: dto });
  }

  async update(id: string, dto: UpdateVanDto) {
    if (dto.vanName === undefined && dto.driver === undefined) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Nothing to update' });
    }
    const v = await this.prisma.van.findFirst({ where: { id, deletedAt: null } });
    if (!v) throw new NotFoundException({ code: 'NOT_FOUND', message: `Van ${id} not found` });
    return this.prisma.van.update({
      where: { id },
      data: {
        ...(dto.vanName !== undefined ? { vanName: dto.vanName } : {}),
        ...(dto.driver !== undefined ? { driver: dto.driver } : {}),
      },
    });
  }

  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const v = await tx.van.findFirst({ where: { id, deletedAt: null } });
      if (!v) throw new NotFoundException({ code: 'NOT_FOUND', message: `Van ${id} not found` });

      // block delete if any open van-side allocation remains (van still holds stock)
      const openLines = await tx.distributionLine.findMany({
        where: { distribution: { vanId: id, deletedAt: null } },
        select: { id: true },
      });
      const lineIds = openLines.map((l) => l.id);
      if (lineIds.length) {
        const open = await tx.stockLotAllocation.aggregate({
          where: {
            consumerType: StockLotConsumerType.DISTRIBUTION_LINE,
            consumerId: { in: lineIds },
            remainingQuantity: { gt: 0 },
          },
          _sum: { remainingQuantity: true },
        });
        if ((open._sum.remainingQuantity ?? 0) > 0) {
          throw new ConflictException({
            code: 'IN_USE',
            message: 'Van still holds undelivered stock; settle distributions first',
            fields: { remaining: open._sum.remainingQuantity },
          });
        }
      }

      await tx.van.update({ where: { id }, data: { deletedAt: new Date() } });
      return { id, deleted: true };
    });
  }

  async todaySummary(vanId: string) {
    const { startUtc, endUtc } = dhakaDayBoundsUtc();
    const dayDate = dhakaTodayDateOnly();
    const [salesAgg, distroLines] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: { vanId, deletedAt: null, createdAt: { gte: startUtc, lt: endUtc } },
        _sum: { total: true },
      }),
      this.prisma.distributionLine.findMany({
        where: { distribution: { vanId, date: dayDate } },
        select: { allocated: true, returned: true },
      }),
    ]);
    const distributed = distroLines.reduce((s, l) => s + l.allocated, 0);
    const returned = distroLines.reduce((s, l) => s + l.returned, 0);
    return {
      sales: salesAgg._sum.total ?? 0,
      distributed,
      returned,
    };
  }

  async distributionForDate(vanId: string, date?: string) {
    const day = date ? parseDhakaDateOnly(date) : dhakaTodayDateOnly();
    // A van can have several distributions on the same date (morning load
    // plus mid-day top-ups). Flatten their lines into one envelope; envelope
    // `id` points at the most recent load so "Add Product" appends there.
    const distros = await this.prisma.distribution.findMany({
      where: { vanId, date: day, deletedAt: null },
      include: { lines: { include: { product: { select: { name: true, unit: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    if (distros.length === 0) {
      return { id: null, vanId, date: day.toISOString().slice(0, 10), lines: [] };
    }
    const lines = distros.flatMap((d) => d.lines);
    const latest = distros[distros.length - 1];
    return { id: latest.id, vanId, date: day.toISOString().slice(0, 10), lines };
  }

  async stockSummary(vanId: string, date?: string): Promise<VanStockSummary> {
    const van = await this.prisma.van.findFirst({ where: { id: vanId, deletedAt: null } });
    if (!van) throw new NotFoundException({ code: 'NOT_FOUND', message: `Van ${vanId} not found` });

    const day = date ? parseDhakaDateOnly(date) : dhakaTodayDateOnly();
    const dayStr = day.toISOString().slice(0, 10);

    const distros = await this.prisma.distribution.findMany({
      where: { vanId, date: day, deletedAt: null },
      include: {
        lines: { include: { product: { select: { name: true, unit: true, tradePrice: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const distroLines = distros.flatMap((d) => d.lines);
    const latestDistributionId = distros.length > 0 ? distros[distros.length - 1].id : null;

    if (distroLines.length === 0) {
      return {
        vanId,
        date: dayStr,
        van: { vanName: van.vanName, driver: van.driver },
        distributionId: latestDistributionId,
        products: [],
        reconciliation: { isBalanced: true, discrepancies: [] },
      };
    }

    const productIds = Array.from(new Set(distroLines.map((l) => l.productId)));
    const lineIds = distroLines.map((l) => l.id);
    const [saleAgg, damageAgg, vanLotAllocations, saleFinancialRows] = await Promise.all([
      this.prisma.saleItem.groupBy({
        by: ['productId'],
        where: {
          sale: { vanId, date: day, deletedAt: null },
          productId: { in: productIds },
        },
        _sum: { qty: true },
      }),
      this.prisma.stockAdjustment.groupBy({
        by: ['productId'],
        where: {
          vanId,
          location: StockLocation.VAN,
          date: day,
          deletedAt: null,
          productId: { in: productIds },
        },
        _sum: { quantity: true },
      }),
      this.prisma.stockLotAllocation.findMany({
        where: {
          consumerType: StockLotConsumerType.DISTRIBUTION_LINE,
          consumerId: { in: lineIds },
        },
        include: { stockEntry: { select: { productId: true, condition: true, tradePrice: true } } },
      }),
      this.prisma.$queryRaw<
        { productId: string; soldRevenue: bigint | null; soldCost: bigint | null }[]
      >`
        SELECT si."productId" AS "productId",
          COALESCE(SUM(a.quantity * si.price), 0)::bigint AS "soldRevenue",
          COALESCE(SUM(a.quantity * a."unitCost"), 0)::bigint AS "soldCost"
        FROM stock_lot_allocations a
        JOIN sale_items si ON si.id = a."consumerId" AND a."consumerType" = 'SALE_ITEM'::"StockLotConsumerType"
        JOIN sales s ON s.id = si."saleId"
        WHERE s."deletedAt" IS NULL
          AND s."vanId" = ${vanId}
          AND s.date = ${day}
          AND si."productId" IN (${Prisma.join(productIds)})
        GROUP BY si."productId"
      `,
    ]);
    const soldByProduct = new Map(saleAgg.map((s) => [s.productId, s._sum.qty ?? 0]));
    const damagedByProduct = new Map(damageAgg.map((d) => [d.productId, d._sum.quantity ?? 0]));
    const financialByProduct = new Map(
      saleFinancialRows.map((row) => [
        row.productId,
        {
          soldRevenue: Number(row.soldRevenue ?? 0),
          soldCost: Number(row.soldCost ?? 0),
        },
      ]),
    );

    // If a van's on-day allocation drew from a DAMAGED lot (i.e. redistributed
    // salvage stock), surface that lot's reduced tradePrice so the driver never
    // defaults back to the product's full price when selling it.
    const damagedPriceByProduct = new Map<string, number | null>();
    for (const alloc of vanLotAllocations) {
      if (alloc.stockEntry.condition === 'DAMAGED') {
        damagedPriceByProduct.set(alloc.stockEntry.productId, alloc.stockEntry.tradePrice);
      }
    }

    const grouped = new Map<
      string,
      {
        allocated: number;
        returned: number;
        damageReturned: number;
        product: { name: string; unit: string; tradePrice: number } | null;
      }
    >();
    for (const line of distroLines) {
      const cur = grouped.get(line.productId) ?? {
        allocated: 0,
        returned: 0,
        damageReturned: 0,
        product: line.product
          ? {
              name: line.product.name,
              unit: line.product.unit,
              tradePrice: line.product.tradePrice,
            }
          : null,
      };
      cur.allocated += line.allocated;
      cur.returned += line.returned;
      cur.damageReturned += line.damageReturned;
      grouped.set(line.productId, cur);
    }

    const products = Array.from(grouped.entries()).map(([productId, agg]) => {
      const sold = soldByProduct.get(productId) ?? 0;
      // line.damageReturned covers salvage/wastage taken off distribution lines;
      // stock adjustments cover van damage recorded outside a distribution.
      const damaged = (damagedByProduct.get(productId) ?? 0) + agg.damageReturned;
      const available = agg.allocated - agg.returned - sold - damaged;
      const damagedPrice = damagedPriceByProduct.get(productId);
      const isDamagedStock = damagedPrice !== undefined;
      const financial = financialByProduct.get(productId) ?? { soldRevenue: 0, soldCost: 0 };
      const profit = financial.soldRevenue - financial.soldCost;
      return {
        productId,
        name: agg.product?.name ?? null,
        unit: agg.product?.unit ?? null,
        allocated: agg.allocated,
        returned: agg.returned,
        sold,
        damaged,
        available,
        soldRevenue: financial.soldRevenue,
        soldCost: financial.soldCost,
        profit,
        profitMargin:
          financial.soldRevenue > 0
            ? Math.round((profit / financial.soldRevenue) * 10000) / 100
            : 0,
        unitPrice: isDamagedStock ? damagedPrice : (agg.product?.tradePrice ?? null),
        isDamagedStock,
      };
    });

    const discrepancies = products
      .filter((p) => p.available < 0)
      .map((p) => ({
        productId: p.productId,
        name: p.name,
        available: p.available,
        reason: 'over_consumed',
      }));

    return {
      vanId,
      date: dayStr,
      van: { vanName: van.vanName, driver: van.driver },
      distributionId: latestDistributionId,
      products,
      reconciliation: {
        isBalanced: discrepancies.length === 0,
        discrepancies,
      },
    };
  }

  async activity(vanId: string, date?: string) {
    const van = await this.prisma.van.findFirst({ where: { id: vanId, deletedAt: null } });
    if (!van) throw new NotFoundException({ code: 'NOT_FOUND', message: `Van ${vanId} not found` });

    const day = date ? parseDhakaDateOnly(date) : dhakaTodayDateOnly();
    const dayStr = day.toISOString().slice(0, 10);

    const distros = await this.prisma.distribution.findMany({
      where: { vanId, date: day, deletedAt: null },
      include: { lines: { include: { product: { select: { name: true, unit: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    const allLines = distros.flatMap((d) => d.lines);
    const latestDistributionId = distros.length > 0 ? distros[distros.length - 1].id : null;

    if (distros.length === 0) {
      return {
        vanId,
        date: dayStr,
        van: { vanName: van.vanName, driver: van.driver },
        distributionId: null,
        events: [],
      };
    }

    const lineIds = allLines.map((l) => l.id);
    const lineMap = new Map(allLines.map((l) => [l.id, l]));
    // Map each line id back to the parent distribution's createdAt so the
    // ALLOCATION event for top-ups carries the correct timestamp.
    const lineToDistroCreatedAt = new Map<string, Date>();
    for (const d of distros) for (const l of d.lines) lineToDistroCreatedAt.set(l.id, d.createdAt);

    const [sales, adjustments, lineAudits] = await Promise.all([
      this.prisma.sale.findMany({
        where: { vanId, date: day, deletedAt: null },
        include: {
          items: { include: { product: { select: { name: true, unit: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.stockAdjustment.findMany({
        where: { vanId, location: StockLocation.VAN, date: day, deletedAt: null },
        include: { product: { select: { name: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      lineIds.length
        ? this.prisma.auditLog.findMany({
            where: {
              entity: 'DistributionLine',
              entityId: { in: lineIds },
              action: AuditAction.UPDATE,
            },
            orderBy: { occurredAt: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    type Event = {
      id: string;
      occurredAt: Date;
      type: 'ALLOCATION' | 'SALE' | 'RETURN' | 'DAMAGE' | 'WASTAGE' | 'CORRECTION';
      productId: string;
      productName: string | null;
      productUnit: string | null;
      quantity: number;
      notes: string | null;
      saleId?: string;
      invoiceId?: string | null;
      adjustmentId?: string;
      distributionLineId?: string;
      price?: number;
    };

    const events: Event[] = [];

    for (const line of allLines) {
      if (line.allocated <= 0) continue;
      events.push({
        id: `ALLOC-${line.id}`,
        occurredAt: lineToDistroCreatedAt.get(line.id) ?? new Date(),
        type: 'ALLOCATION',
        productId: line.productId,
        productName: line.product?.name ?? null,
        productUnit: line.product?.unit ?? null,
        quantity: line.allocated,
        notes: null,
        distributionLineId: line.id,
      });
    }

    for (const sale of sales) {
      for (const item of sale.items) {
        events.push({
          id: `SALE-${item.id}`,
          occurredAt: sale.createdAt,
          type: 'SALE',
          productId: item.productId,
          productName: item.product?.name ?? null,
          productUnit: item.product?.unit ?? null,
          quantity: item.qty,
          notes: null,
          saleId: sale.id,
          invoiceId: sale.invoiceId,
          price: item.price,
        });
      }
    }

    for (const adj of adjustments) {
      events.push({
        id: `ADJ-${adj.id}`,
        occurredAt: adj.createdAt,
        type: adj.reason as 'DAMAGE' | 'WASTAGE' | 'CORRECTION',
        productId: adj.productId,
        productName: adj.product?.name ?? null,
        productUnit: adj.product?.unit ?? null,
        quantity: adj.quantity,
        notes: adj.notes,
        adjustmentId: adj.id,
      });
    }

    for (const audit of lineAudits) {
      const meta = (audit.meta ?? {}) as {
        returnedDelta?: number;
        damageDelta?: number;
        salvage?: boolean;
        salvagePrice?: number;
        productId?: string;
      };
      const line = lineMap.get(audit.entityId);
      const returnedDelta = meta.returnedDelta ?? 0;
      if (returnedDelta > 0) {
        events.push({
          id: `RET-${audit.id}`,
          occurredAt: audit.occurredAt,
          type: 'RETURN',
          productId: line?.productId ?? meta.productId ?? '',
          productName: line?.product?.name ?? null,
          productUnit: line?.product?.unit ?? null,
          quantity: returnedDelta,
          notes: null,
          distributionLineId: audit.entityId,
        });
      }
      // salvage = damaged goods re-entered as a reduced-price DAMAGED lot;
      // a plain damageDelta burn is wastage (total loss)
      const damageDelta = meta.damageDelta ?? 0;
      if (damageDelta > 0) {
        events.push({
          id: `DMG-${audit.id}`,
          occurredAt: audit.occurredAt,
          type: meta.salvage ? 'DAMAGE' : 'WASTAGE',
          productId: line?.productId ?? meta.productId ?? '',
          productName: line?.product?.name ?? null,
          productUnit: line?.product?.unit ?? null,
          quantity: damageDelta,
          notes: null,
          distributionLineId: audit.entityId,
          price: meta.salvage ? meta.salvagePrice : undefined,
        });
      }
    }

    events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    return {
      vanId,
      date: dayStr,
      van: { vanName: van.vanName, driver: van.driver },
      distributionId: latestDistributionId,
      events,
    };
  }
}
