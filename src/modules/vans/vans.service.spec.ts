import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { VansService } from './vans.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('VansService.stockSummary', () => {
  function makePrismaMock(opts: {
    van?: { id: string; vanName: string; driver: string } | null;
    distribution?: {
      id: string;
      lines: Array<{
        productId: string;
        allocated: number;
        returned: number;
        product: { name: string; unit: string };
      }>;
    } | null;
    saleAgg?: Array<{ productId: string; _sum: { qty: number | null } }>;
    damageAgg?: Array<{ productId: string; _sum: { quantity: number | null } }>;
  }) {
    const prisma = {
      van: {
        findFirst: () => Promise.resolve(opts.van ?? null),
      },
      distribution: {
        findUnique: () => Promise.resolve(opts.distribution ?? null),
      },
      saleItem: {
        groupBy: () => Promise.resolve(opts.saleAgg ?? []),
      },
      stockAdjustment: {
        groupBy: () => Promise.resolve(opts.damageAgg ?? []),
      },
    } as unknown as PrismaService;
    return prisma;
  }

  it('throws NotFoundException when van does not exist', async () => {
    const prisma = makePrismaMock({ van: null });
    const svc = new VansService(prisma);
    await assert.rejects(svc.stockSummary('V99', '2026-04-29'), NotFoundException);
  });

  it('returns empty summary when van has no distribution for date', async () => {
    const prisma = makePrismaMock({
      van: { id: 'V1', vanName: 'Truck A', driver: 'Karim' },
      distribution: null,
    });
    const svc = new VansService(prisma);
    const out = await svc.stockSummary('V1', '2026-04-29');
    assert.equal(out.vanId, 'V1');
    assert.deepEqual(out.products, []);
    assert.equal(out.reconciliation.isBalanced, true);
  });

  it('aggregates allocated/sold/damaged correctly', async () => {
    const prisma = makePrismaMock({
      van: { id: 'V1', vanName: 'Truck A', driver: 'Karim' },
      distribution: {
        id: 'DST-001',
        lines: [
          {
            productId: 'PRD-001',
            allocated: 20,
            returned: 0,
            product: { name: 'Rice', unit: 'kg' },
          },
          {
            productId: 'PRD-002',
            allocated: 50,
            returned: 5,
            product: { name: 'Sugar', unit: 'kg' },
          },
        ],
      },
      saleAgg: [
        { productId: 'PRD-001', _sum: { qty: 12 } },
        { productId: 'PRD-002', _sum: { qty: 30 } },
      ],
      damageAgg: [{ productId: 'PRD-001', _sum: { quantity: 2 } }],
    });
    const svc = new VansService(prisma);
    const out = await svc.stockSummary('V1', '2026-04-29');

    const rice = out.products.find((p) => p.productId === 'PRD-001')!;
    const sugar = out.products.find((p) => p.productId === 'PRD-002')!;

    assert.equal(rice.allocated, 20);
    assert.equal(rice.sold, 12);
    assert.equal(rice.damaged, 2);
    assert.equal(rice.returned, 0);
    assert.equal(rice.available, 6); // 20 - 0 - 12 - 2

    assert.equal(sugar.allocated, 50);
    assert.equal(sugar.sold, 30);
    assert.equal(sugar.damaged, 0);
    assert.equal(sugar.returned, 5);
    assert.equal(sugar.available, 15); // 50 - 5 - 30 - 0

    assert.equal(out.reconciliation.isBalanced, true);
    assert.equal(out.reconciliation.discrepancies.length, 0);
  });

  it('flags discrepancy when consumption exceeds allocated (over-sell)', async () => {
    const prisma = makePrismaMock({
      van: { id: 'V1', vanName: 'Truck A', driver: 'Karim' },
      distribution: {
        id: 'DST-001',
        lines: [
          {
            productId: 'PRD-001',
            allocated: 10,
            returned: 0,
            product: { name: 'Rice', unit: 'kg' },
          },
        ],
      },
      saleAgg: [{ productId: 'PRD-001', _sum: { qty: 12 } }],
      damageAgg: [],
    });
    const svc = new VansService(prisma);
    const out = await svc.stockSummary('V1', '2026-04-29');

    const rice = out.products[0];
    assert.equal(rice.available, -2);
    assert.equal(out.reconciliation.isBalanced, false);
    assert.equal(out.reconciliation.discrepancies.length, 1);
    assert.equal(out.reconciliation.discrepancies[0].productId, 'PRD-001');
  });

  it('merges multiple distribution lines for the same product', async () => {
    const prisma = makePrismaMock({
      van: { id: 'V1', vanName: 'Truck A', driver: 'Karim' },
      distribution: {
        id: 'DST-001',
        lines: [
          {
            productId: 'PRD-001',
            allocated: 10,
            returned: 1,
            product: { name: 'Rice', unit: 'kg' },
          },
          {
            productId: 'PRD-001',
            allocated: 5,
            returned: 0,
            product: { name: 'Rice', unit: 'kg' },
          },
        ],
      },
      saleAgg: [],
      damageAgg: [],
    });
    const svc = new VansService(prisma);
    const out = await svc.stockSummary('V1', '2026-04-29');
    assert.equal(out.products.length, 1);
    assert.equal(out.products[0].allocated, 15);
    assert.equal(out.products[0].returned, 1);
    assert.equal(out.products[0].available, 14);
  });
});
