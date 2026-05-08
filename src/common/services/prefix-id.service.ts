import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaClient;

@Injectable()
export class PrefixIdService {
  constructor(private readonly prisma: PrismaService) {}

  async next(prefix: string, width = 3, client?: Tx): Promise<string> {
    const db = client ?? this.prisma;
    const seq = await db.idSequence.upsert({
      where: { prefix },
      create: { prefix, next: 2, width },
      update: { next: { increment: 1 } },
    });
    const issued = seq.next - 1;
    return `${prefix}-${String(issued).padStart(seq.width ?? width, '0')}`;
  }
}
