import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, StockLotConsumerType } from '@prisma/client';
import { ListResponse, listResponse } from '../../common/dto/pagination.dto';
import { InsufficientStockException } from '../../common/exceptions/insufficient-stock.exception';
import { PrefixIdService } from '../../common/services/prefix-id.service';
import { StockLotService } from '../../common/services/stock-lot.service';
import { parseDhakaDateOnly } from '../../common/util/dhaka-time';
import { PrismaService } from '../../prisma/prisma.service';
import { AddDistributionLineDto } from './dto/add-line.dto';
import { CreateDistributionDto } from './dto/create-distribution.dto';
import { ListDistributionsQueryDto } from './dto/list-distributions.query';
import { UpdateDistributionLineDto } from './dto/update-line.dto';

@Injectable()
export class DistributionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: PrefixIdService,
    private readonly lots: StockLotService,
  ) {}

  async create(dto: CreateDistributionDto) {
    const date = parseDhakaDateOnly(dto.date);
    const { distro, productIds } = await this.prisma.$transaction(
      async (tx) => {
      const van = await tx.van.findFirst({ where: { id: dto.vanId, deletedAt: null } });
      if (!van) {
        throw new BadRequestException({
          code: 'INVALID_VAN',
          message: `Van ${dto.vanId} not found`,
          fields: { vanId: 'unknown' },
        });
      }

      const reqProductIds = dto.lines.map((l) => l.productId);
      const products = await tx.product.findMany({
        where: { id: { in: reqProductIds }, deletedAt: null },
        select: { id: true },
      });
      if (products.length !== new Set(reqProductIds).size) {
        const known = new Set(products.map((p) => p.id));
        const missing = reqProductIds.find((id) => !known.has(id));
        throw new BadRequestException({
          code: 'INVALID_PRODUCT',
          message: `Product ${missing} not found`,
        });
      }

      const id = await this.ids.next('DST', 3, tx);
      const distro = await tx.distribution.create({
        data: {
          id,
          vanId: dto.vanId,
          date,
          lines: {
            create: dto.lines.map((l) => ({
              productId: l.productId,
              allocated: l.allocated,
            })),
          },
        },
        include: { lines: true },
      });

      const allocatedPerLine = await Promise.all(
        distro.lines.map((line) =>
          this.lots
            .allocateFromWarehouse(tx, line.productId, line.allocated)
            .then((slices) => ({ line, slices })),
        ),
      );
      const allocationRows = allocatedPerLine.flatMap(({ line, slices }) =>
        slices.map((s) => ({
          stockEntryId: s.stockEntryId,
          consumerType: StockLotConsumerType.DISTRIBUTION_LINE,
          consumerId: line.id,
          quantity: s.quantity,
          remainingQuantity: s.quantity,
          unitCost: s.unitCost,
        })),
      );
      if (allocationRows.length > 0) {
        await tx.stockLotAllocation.createMany({ data: allocationRows });
      }

      const uniqueProductIds = Array.from(new Set(distro.lines.map((l) => l.productId)));
      return { distro, productIds: uniqueProductIds };
    },
      { timeout: 60000, maxWait: 8000 },
    );

    // Recompute Product.stock after commit so a slow aggregate can't push the
    // write transaction past its timeout. Best-effort: a failure here just
    // means the next mutation on the same product will reconcile.
    await this.recomputeProductsBestEffort(productIds);

    return distro;
  }

  async findAll(q: ListDistributionsQueryDto): Promise<ListResponse<unknown>> {
    const where: Prisma.DistributionWhereInput = {
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
              { van: { vanName: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const orderBy = q.parseSort(['date', 'createdAt']) ?? { date: 'desc' };
    const [items, total] = await Promise.all([
      this.prisma.distribution.findMany({
        where,
        orderBy,
        skip: q.skip,
        take: q.take,
        include: {
          van: { select: { vanName: true } },
          lines: { include: { product: { select: { name: true, unit: true } } } },
        },
      }),
      this.prisma.distribution.count({ where }),
    ]);
    return listResponse(items, total, q);
  }

  async findOne(id: string) {
    const distro = await this.prisma.distribution.findFirst({
      where: { id, deletedAt: null },
      include: {
        van: true,
        lines: { include: { product: { select: { name: true, unit: true } } } },
      },
    });
    if (!distro) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Distribution ${id} not found` });
    }
    return distro;
  }

  async remove(id: string) {
    const { productIds } = await this.prisma.$transaction(
      async (tx) => {
        const distro = await tx.distribution.findFirst({
          where: { id, deletedAt: null },
          include: { lines: { select: { id: true, productId: true } } },
        });
        if (!distro) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: `Distribution ${id} not found`,
          });
        }
        const lineIds = distro.lines.map((l) => l.id);
        if (lineIds.length === 0) {
          await tx.distribution.update({ where: { id }, data: { deletedAt: new Date() } });
          return { productIds: [] as string[] };
        }

        // any sale already consumed from these line allocations? block.
        const allocs = await tx.stockLotAllocation.findMany({
          where: {
            consumerType: StockLotConsumerType.DISTRIBUTION_LINE,
            consumerId: { in: lineIds },
          },
        });
        const allocIds = allocs.map((a) => a.id);
        const childGroups = allocIds.length
          ? await tx.stockLotAllocation.groupBy({
              by: ['parentAllocationId'],
              where: { parentAllocationId: { in: allocIds } },
              _count: { _all: true },
            })
          : [];
        if (childGroups.some((g) => g._count._all > 0)) {
          throw new InsufficientStockException(
            distro.lines.map((l) => l.productId),
            'Cannot delete distribution: downstream sales or adjustments already consumed from it',
          );
        }

        // return remaining van stock back to source StockEntry rows + drop allocs
        await Promise.all([
          ...allocs
            .filter((a) => a.remainingQuantity > 0)
            .map((a) =>
              tx.stockEntry.update({
                where: { id: a.stockEntryId },
                data: { remainingQuantity: { increment: a.remainingQuantity } },
              }),
            ),
          allocIds.length
            ? tx.stockLotAllocation.deleteMany({ where: { id: { in: allocIds } } })
            : Promise.resolve(),
        ]);

        await tx.distributionLine.deleteMany({ where: { distributionId: id } });
        await tx.distribution.update({ where: { id }, data: { deletedAt: new Date() } });

        return { productIds: Array.from(new Set(distro.lines.map((l) => l.productId))) };
      },
      { timeout: 60000, maxWait: 8000 },
    );

    await this.recomputeProductsBestEffort(productIds);
  }

  async addLine(distributionId: string, dto: AddDistributionLineDto) {
    const { line, productId } = await this.prisma.$transaction(
      async (tx) => {
        const distribution = await tx.distribution.findFirst({
          where: { id: distributionId, deletedAt: null },
          select: { id: true },
        });
        if (!distribution) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: `Distribution ${distributionId} not found`,
          });
        }

        const product = await tx.product.findFirst({
          where: { id: dto.productId, deletedAt: null },
          select: { id: true },
        });
        if (!product) {
          throw new BadRequestException({
            code: 'INVALID_PRODUCT',
            message: `Product ${dto.productId} not found`,
          });
        }

        const existing = await tx.distributionLine.findFirst({
          where: { distributionId, productId: dto.productId },
          select: { id: true },
        });
        if (existing) {
          throw new BadRequestException({
            code: 'DUPLICATE_LINE',
            message: `Product ${dto.productId} is already on this distribution; edit the existing line instead`,
          });
        }

        const line = await tx.distributionLine.create({
          data: {
            distributionId,
            productId: dto.productId,
            allocated: dto.allocated,
          },
        });

        const slices = await this.lots.allocateFromWarehouse(tx, dto.productId, dto.allocated);
        if (slices.length > 0) {
          await tx.stockLotAllocation.createMany({
            data: slices.map((s) => ({
              stockEntryId: s.stockEntryId,
              consumerType: StockLotConsumerType.DISTRIBUTION_LINE,
              consumerId: line.id,
              quantity: s.quantity,
              remainingQuantity: s.quantity,
              unitCost: s.unitCost,
            })),
          });
        }

        return { line, productId: dto.productId };
      },
      { timeout: 60000, maxWait: 8000 },
    );

    await this.recomputeProductsBestEffort([productId]);
    return line;
  }

  async updateLine(distributionId: string, lineId: string, dto: UpdateDistributionLineDto) {
    if (dto.allocated === undefined && dto.returned === undefined && dto.damageReturned === undefined) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Nothing to update' });
    }
    const { updated, productId } = await this.prisma.$transaction(
      async (tx) => {
      const line = await tx.distributionLine.findFirst({
        where: { id: lineId, distributionId },
      });
      if (!line) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Line not found' });

      const allocatedDelta =
        dto.allocated !== undefined ? dto.allocated - line.allocated : 0;
      const returnedDelta =
        dto.returned !== undefined ? dto.returned - line.returned : 0;
      const damageDelta =
        dto.damageReturned !== undefined ? dto.damageReturned - line.damageReturned : 0;

      const insertSlices = async (qty: number) => {
        const slices = await this.lots.allocateFromWarehouse(tx, line.productId, qty);
        if (slices.length === 0) return;
        await tx.stockLotAllocation.createMany({
          data: slices.map((s) => ({
            stockEntryId: s.stockEntryId,
            consumerType: StockLotConsumerType.DISTRIBUTION_LINE,
            consumerId: line.id,
            quantity: s.quantity,
            remainingQuantity: s.quantity,
            unitCost: s.unitCost,
          })),
        });
      };

      if (allocatedDelta > 0) {
        await insertSlices(allocatedDelta);
      } else if (allocatedDelta < 0) {
        await this.lots.returnVanLotsToWarehouse(tx, line.id, -allocatedDelta);
      }

      if (returnedDelta > 0) {
        // Normal return: goes back to warehouse
        await this.lots.returnVanLotsToWarehouse(tx, line.id, returnedDelta);
      } else if (returnedDelta < 0) {
        await insertSlices(-returnedDelta);
      }

      if (damageDelta > 0) {
        // Damage return: consume from van-side allocation WITHOUT restoring to warehouse
        // We burn the remainingQuantity of van allocations without restoring source stockEntry
        const vanAllocs = await tx.stockLotAllocation.findMany({
          where: {
            consumerType: StockLotConsumerType.DISTRIBUTION_LINE,
            consumerId: line.id,
            remainingQuantity: { gt: 0 },
          },
          orderBy: { createdAt: 'asc' },
        });
        let toConsume = damageDelta;
        for (const alloc of vanAllocs) {
          if (toConsume <= 0) break;
          const consume = Math.min(alloc.remainingQuantity, toConsume);
          await tx.stockLotAllocation.update({
            where: { id: alloc.id },
            data: { remainingQuantity: { decrement: consume } },
          });
          toConsume -= consume;
        }
        // Note: toConsume > 0 means we tried to mark more damage than available on van
        // We allow it partially — the loss is tracked via damageReturned field
      } else if (damageDelta < 0) {
        // Reverting damage: add units back to van-side allocation
        await insertSlices(-damageDelta);
      }

      const updated = await tx.distributionLine.update({
        where: { id: lineId },
        data: {
          ...(dto.allocated !== undefined ? { allocated: dto.allocated } : {}),
          ...(dto.returned !== undefined ? { returned: dto.returned } : {}),
          ...(dto.damageReturned !== undefined ? { damageReturned: dto.damageReturned } : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          action: AuditAction.UPDATE,
          entity: 'DistributionLine',
          entityId: line.id,
          before: {
            allocated: line.allocated,
            returned: line.returned,
            damageReturned: line.damageReturned,
          } as unknown as Prisma.InputJsonValue,
          after: {
            allocated: updated.allocated,
            returned: updated.returned,
            damageReturned: updated.damageReturned,
          } as unknown as Prisma.InputJsonValue,
          meta: {
            distributionId,
            productId: line.productId,
            allocatedDelta,
            returnedDelta,
            damageDelta,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return { updated, productId: line.productId };
    },
      { timeout: 60000, maxWait: 8000 },
    );

    await this.recomputeProductsBestEffort([productId]);
    return updated;
  }


  async removeLine(distributionId: string, lineId: string) {
    const { productId } = await this.prisma.$transaction(
      async (tx) => {
      const line = await tx.distributionLine.findFirst({
        where: { id: lineId, distributionId },
      });
      if (!line) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Line not found' });

      // reverse all lot allocations tied to this line (returns remaining van stock to StockEntry)
      const allocs = await tx.stockLotAllocation.findMany({
        where: {
          consumerType: StockLotConsumerType.DISTRIBUTION_LINE,
          consumerId: line.id,
        },
      });
      const allocIds = allocs.map((a) => a.id);
      // single grouped query instead of N counts
      const childGroups = allocIds.length
        ? await tx.stockLotAllocation.groupBy({
            by: ['parentAllocationId'],
            where: { parentAllocationId: { in: allocIds } },
            _count: { _all: true },
          })
        : [];
      const childCountMap = new Map(
        childGroups.map((g) => [g.parentAllocationId!, g._count._all]),
      );
      for (const a of allocs) {
        if ((childCountMap.get(a.id) ?? 0) > 0) {
          throw new InsufficientStockException(
            [line.productId],
            'Cannot remove distribution line: downstream sales or adjustments already consumed from it',
          );
        }
      }
      // batch all writes in parallel
      await Promise.all([
        ...allocs
          .filter((a) => a.remainingQuantity > 0)
          .map((a) =>
            tx.stockEntry.update({
              where: { id: a.stockEntryId },
              data: { remainingQuantity: { increment: a.remainingQuantity } },
            }),
          ),
        allocIds.length
          ? tx.stockLotAllocation.deleteMany({ where: { id: { in: allocIds } } })
          : Promise.resolve(),
      ]);

      await tx.distributionLine.delete({ where: { id: lineId } });
      return { productId: line.productId };
    },
      { timeout: 60000, maxWait: 8000 },
    );

    await this.recomputeProductsBestEffort([productId]);
  }

  /**
   * Recompute Product.stock for the given products *outside* the request's
   * write transaction. Run sequentially (not in parallel) to avoid contending
   * with the same connection pool while the response is being sent.
   *
   * Best-effort: a failure here just leaves Product.stock momentarily out of
   * sync; the next mutation on the same product reconciles it.
   */
  private async recomputeProductsBestEffort(productIds: string[]) {
    for (const pid of productIds) {
      try {
        await this.prisma.$transaction(
          async (tx) => this.lots.recomputeProductStock(tx, pid),
          { timeout: 30000, maxWait: 5000 },
        );
      } catch {
        // swallow — best-effort
      }
    }
  }
}
