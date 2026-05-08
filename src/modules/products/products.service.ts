import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { listResponse, ListResponse } from '../../common/dto/pagination.dto';
import { PrefixIdService } from '../../common/services/prefix-id.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products.query';
import { UpdateProductDto } from './dto/update-product.dto';

const SORTABLE = ['name', 'sellPrice', 'buyPrice', 'stock', 'createdAt'] as const;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService, private readonly ids: PrefixIdService) {}

  async create(dto: CreateProductDto) {
    await this.assertCategory(dto.categoryId);
    await this.assertNameUnique(dto.name);

    return this.prisma.$transaction(async (tx) => {
      const id = await this.ids.next('PRD', 3, tx);
      const product = await tx.product.create({ data: { id, ...dto } });
      await tx.auditLog.create({
        data: {
          action: AuditAction.CREATE,
          entity: 'Product',
          entityId: id,
          after: product as unknown as Prisma.InputJsonValue,
        },
      });
      return product;
    });
  }

  async findAll(q: ListProductsQueryDto): Promise<ListResponse<unknown>> {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { id: { contains: q.q.toUpperCase() } }] }
        : {}),
    };
    const orderBy = q.parseSort(SORTABLE) ?? { createdAt: 'desc' };
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({ where, orderBy, skip: q.skip, take: q.take, include: { category: true } }),
      this.prisma.product.count({ where }),
    ]);
    return listResponse(items, total, q);
  }

  async findOne(id: string) {
    const p = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: { category: true },
    });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: `Product ${id} not found` });
    return p;
  }

  async update(id: string, dto: UpdateProductDto) {
    const before = await this.findOne(id);
    if (dto.categoryId && dto.categoryId !== before.categoryId) {
      await this.assertCategory(dto.categoryId);
    }
    if (dto.name && dto.name !== before.name) {
      await this.assertNameUnique(dto.name, id);
    }

    return this.prisma.$transaction(async (tx) => {
      const after = await tx.product.update({ where: { id }, data: dto });
      await tx.auditLog.create({
        data: {
          action: AuditAction.UPDATE,
          entity: 'Product',
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
      await tx.product.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          action: AuditAction.DELETE,
          entity: 'Product',
          entityId: id,
          before: before as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }

  async restore(id: string) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: `Product ${id} not found` });
    if (!p.deletedAt) {
      throw new BadRequestException({
        code: 'NOT_DELETED',
        message: `Product ${id} is not deleted`,
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const restored = await tx.product.update({
        where: { id },
        data: { deletedAt: null },
        include: { category: true },
      });
      await tx.auditLog.create({
        data: {
          action: AuditAction.RESTORE,
          entity: 'Product',
          entityId: id,
          after: restored as unknown as Prisma.InputJsonValue,
        },
      });
      return restored;
    });
  }

  async history(id: string) {
    await this.findOne(id);
    const [stockEntries, stockAdjustments, distributionLines, saleItems, audit] = await Promise.all([
      this.prisma.stockEntry.findMany({
        where: { productId: id, deletedAt: null },
        orderBy: { date: 'desc' },
        take: 100,
      }),
      this.prisma.stockAdjustment.findMany({
        where: { productId: id, deletedAt: null },
        orderBy: { date: 'desc' },
        take: 100,
        include: { van: { select: { vanName: true } } },
      }),
      this.prisma.distributionLine.findMany({
        where: { productId: id },
        include: { distribution: { select: { id: true, date: true, vanId: true } } },
        orderBy: { distribution: { date: 'desc' } },
        take: 100,
      }),
      this.prisma.saleItem.findMany({
        where: { productId: id },
        include: { sale: { select: { id: true, date: true, vanId: true } } },
        orderBy: { sale: { date: 'desc' } },
        take: 100,
      }),
      this.prisma.auditLog.findMany({
        where: { entity: 'Product', entityId: id },
        orderBy: { occurredAt: 'desc' },
        take: 100,
      }),
    ]);
    return { stockEntries, stockAdjustments, distributionLines, saleItems, audit };
  }

  private async assertCategory(categoryId: string): Promise<void> {
    const cat = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
    });
    if (!cat) {
      throw new BadRequestException({
        code: 'INVALID_CATEGORY',
        message: `Category ${categoryId} not found`,
        fields: { categoryId: 'unknown' },
      });
    }
  }

  private async assertNameUnique(name: string, exceptId?: string): Promise<void> {
    const existing = await this.prisma.product.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        deletedAt: null,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'DUPLICATE_NAME',
        message: `Product "${name}" already exists`,
        fields: { name: 'duplicate' },
      });
    }
  }

  private async assertNotInUse(id: string): Promise<void> {
    const [stk, dist, sale, adj] = await Promise.all([
      this.prisma.stockEntry.count({ where: { productId: id, deletedAt: null } }),
      this.prisma.distributionLine.count({ where: { productId: id } }),
      this.prisma.saleItem.count({ where: { productId: id } }),
      this.prisma.stockAdjustment.count({ where: { productId: id, deletedAt: null } }),
    ]);
    if (stk || dist || sale || adj) {
      throw new ConflictException({
        code: 'IN_USE',
        message: 'Product is referenced by existing records and cannot be deleted',
        fields: {
          stockEntries: stk,
          distributionLines: dist,
          saleItems: sale,
          stockAdjustments: adj,
        },
      });
    }
  }
}
