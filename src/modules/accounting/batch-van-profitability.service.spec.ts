import * as assert from 'node:assert/strict';
import { BatchVanProfitabilityService } from './batch-van-profitability.service';
import { ListBatchVanProfitabilityQueryDto } from './dto/list-batch-van-profitability.query';
import type { PrismaService } from '../../prisma/prisma.service';

describe('BatchVanProfitabilityService.list', () => {
  function makeQuery(overrides: Partial<ListBatchVanProfitabilityQueryDto> = {}) {
    const q = new ListBatchVanProfitabilityQueryDto();
    q.month = '2026-04';
    q.page = 1;
    q.pageSize = 20;
    Object.assign(q, overrides);
    return q;
  }

  function makePrismaMock() {
    const calls: unknown[] = [];
    const prisma = {
      $queryRaw: (parts: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ sql: parts.join('?'), values });
        if (calls.length === 1) {
          return Promise.resolve([
            {
              assignedQty: 25n,
              assignedCost: 900n,
              soldQty: 18n,
              totalSell: 1500n,
              totalCost: 1000n,
              grossProfit: 500n,
              lossQty: 2n,
              lossCost: 90n,
              batchCount: 2n,
            },
          ]);
        }
        if (calls.length === 2) return Promise.resolve([{ total: 2n }]);
        return Promise.resolve([
          {
            batchId: 'BAT-001',
            date: new Date('2026-04-01T00:00:00.000Z'),
            source: 'Karwan Bazar',
            vanId: 'V1',
            vanName: 'Van 1 - North',
            assignedQty: 20n,
            assignedCost: 760n,
            soldQty: 15n,
            soldRevenue: 1200n,
            soldCogs: 800n,
            grossProfit: 400n,
            lossQty: 1n,
            lossCost: 40n,
            remainingQty: 4n,
          },
          {
            batchId: 'BAT-002',
            date: new Date('2026-04-02T00:00:00.000Z'),
            source: 'Savar',
            vanId: 'V2',
            vanName: 'Van 2 - South',
            assignedQty: 5n,
            assignedCost: 140n,
            soldQty: 3n,
            soldRevenue: 300n,
            soldCogs: 200n,
            grossProfit: 100n,
            lossQty: 1n,
            lossCost: 50n,
            remainingQty: 1n,
          },
        ]);
      },
    } as unknown as PrismaService;
    return { prisma, calls };
  }

  it('returns monthly totals and paged batch/van profit rows with margins', async () => {
    const { prisma } = makePrismaMock();
    const svc = new BatchVanProfitabilityService(prisma);

    const out = await svc.list(makeQuery());

    assert.equal(out.page, 1);
    assert.equal(out.pageSize, 20);
    assert.equal(out.total, 2);
    assert.deepEqual(out.totals, {
      totalSell: 1500,
      totalCost: 1000,
      grossProfit: 500,
      profitMargin: 33.33,
      assignedQty: 25,
      assignedCost: 900,
      soldQty: 18,
      lossQty: 2,
      lossCost: 90,
      batchCount: 2,
    });
    assert.equal(out.data[0].batchId, 'BAT-001');
    assert.equal(out.data[0].grossProfit, 400);
    assert.equal(out.data[0].profitMargin, 33.33);
  });

  it('passes optional filters into every query', async () => {
    const { prisma, calls } = makePrismaMock();
    const svc = new BatchVanProfitabilityService(prisma);

    await svc.list(makeQuery({ vanId: 'V1', batchId: 'BAT-001', productId: 'PRD-001' }));

    assert.equal(calls.length, 3);
    for (const call of calls as Array<{ values: unknown[] }>) {
      assert.ok(call.values.includes('V1'));
      assert.ok(call.values.includes('BAT-001'));
      assert.ok(call.values.includes('PRD-001'));
    }
  });
});
