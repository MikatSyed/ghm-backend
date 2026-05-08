import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { startOfDay, endOfDay } from 'date-fns';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: dto,
    });
  }

  async findAll() {
    return this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { products: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.findOne(id);
    return this.prisma.category.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.category.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /**
   * Daily category stats: Total quantity and Weight (for those in kg)
   */
  async getDailyStats(date: Date = new Date()) {
    const start = startOfDay(date);
    const end = endOfDay(date);

    const categories = await this.prisma.category.findMany({
      where: { deletedAt: null },
      include: {
        products: {
          include: {
            saleItems: {
              where: {
                sale: {
                  date: { gte: start, lte: end },
                },
              },
            },
          },
        },
      },
    });

    return categories.map((cat) => {
      let totalQty = 0;
      let totalKg = 0;

      cat.products.forEach((prod) => {
        const soldQty = prod.saleItems.reduce((acc, item) => acc + item.qty, 0);
        totalQty += soldQty;
        if (prod.unit === 'kg') {
          totalKg += soldQty;
        }
      });

      return {
        id: cat.id,
        name: cat.name,
        totalSoldQty: totalQty,
        totalSoldKg: totalKg,
      };
    });
  }
}
