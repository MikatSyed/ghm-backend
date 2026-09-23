import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DistributionOrderStatus } from '@prisma/client';
import { DistributionOrdersService } from './distribution-orders.service';
import { InsufficientStockException } from '../../common/exceptions/insufficient-stock.exception';
import type { PrefixIdService } from '../../common/services/prefix-id.service';
import type { StockLotService } from '../../common/services/stock-lot.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('DistributionOrdersService.create', () => {
  it('creates the issue only — never touches StockLotService', async () => {
    const createCalls: unknown[] = [];
    const tx = {
      customer: { findFirst: () => Promise.resolve({ id: 'CUS-001', deletedAt: null }) },
      product: {
        findMany: () => Promise.resolve([{ id: 'PRD-001' }, { id: 'PRD-002' }]),
      },
      distributionOrder: {
        create: (args: unknown) => {
          createCalls.push(args);
          return Promise.resolve({ id: 'DOR-001' });
        },
      },
    };
    const prisma = {
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(tx),
      distributionOrder: {
        findFirst: () =>
          Promise.resolve({
            id: 'DOR-001',
            status: DistributionOrderStatus.issued,
            customer: { name: 'Cafe Delta' },
            lines: [],
          }),
      },
    } as unknown as PrismaService;
    const ids = { next: () => Promise.resolve('DOR-001') } as unknown as PrefixIdService;
    // No methods defined — if create() ever calls into StockLotService, this throws.
    const lots = {} as unknown as StockLotService;

    const svc = new DistributionOrdersService(prisma, ids, lots);
    const result = await svc.create({
      customerId: 'CUS-001',
      date: '2026-04-18',
      lines: [
        { productId: 'PRD-001', requestedQty: 10, price: 15 },
        { productId: 'PRD-002', requestedQty: 5, price: 20 },
      ],
    });

    assert.equal(result.id, 'DOR-001');
    assert.equal(createCalls.length, 1);
    const createArgs = createCalls[0] as {
      data: { customerId: string; lines: { create: unknown[] } };
    };
    assert.equal(createArgs.data.customerId, 'CUS-001');
    assert.equal(createArgs.data.lines.create.length, 2);
  });

  it('throws BadRequestException for an unknown customer', async () => {
    const tx = { customer: { findFirst: () => Promise.resolve(null) } };
    const prisma = {
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(tx),
    } as unknown as PrismaService;
    const ids = {} as PrefixIdService;
    const lots = {} as StockLotService;
    const svc = new DistributionOrdersService(prisma, ids, lots);
    await assert.rejects(
      svc.create({
        customerId: 'CUS-999',
        date: '2026-04-18',
        lines: [{ productId: 'PRD-001', requestedQty: 1, price: 10 }],
      }),
      BadRequestException,
    );
  });
});

describe('DistributionOrdersService.confirm', () => {
  function makeOrder(status: DistributionOrderStatus = DistributionOrderStatus.issued) {
    return {
      id: 'DOR-001',
      customerId: 'CUS-001',
      date: new Date('2026-04-18'),
      status,
      customer: { name: 'Cafe Delta' },
      lines: [
        { id: 'line-1', productId: 'PRD-001', requestedQty: 10, confirmedQty: null, price: null },
        { id: 'line-2', productId: 'PRD-002', requestedQty: 5, confirmedQty: null, price: null },
      ],
    };
  }

  function makeMocks(opts: {
    order?: ReturnType<typeof makeOrder> | null;
    guardCount?: number;
    allocate?: (
      productId: string,
      qty: number,
    ) => Promise<{ stockEntryId: string; quantity: number; unitCost: number }[]>;
  }) {
    const calls = {
      updateMany: [] as unknown[],
      invoiceCreate: [] as unknown[],
      saleCreate: [] as unknown[],
      allocationCreateMany: [] as unknown[],
      lineUpdate: [] as unknown[],
      orderUpdate: [] as unknown[],
      transactionCreate: [] as unknown[],
      auditCreate: [] as unknown[],
    };

    const tx = {
      distributionOrder: {
        findFirst: () => Promise.resolve(opts.order ?? null),
        updateMany: (args: unknown) => {
          calls.updateMany.push(args);
          return Promise.resolve({ count: opts.guardCount ?? 1 });
        },
        update: (args: unknown) => {
          calls.orderUpdate.push(args);
          return Promise.resolve({});
        },
      },
      distributionOrderLine: {
        update: (args: unknown) => {
          calls.lineUpdate.push(args);
          return Promise.resolve({});
        },
      },
      product: {
        findMany: () =>
          Promise.resolve([
            { id: 'PRD-001', name: 'Tomato' },
            { id: 'PRD-002', name: 'Potato' },
          ]),
      },
      invoice: {
        create: (args: { data: { id: string; total: number } }) => {
          calls.invoiceCreate.push(args);
          return Promise.resolve({
            id: args.data.id,
            date: new Date('2026-04-18'),
            total: args.data.total,
            status: 'unpaid',
            customerId: 'CUS-001',
            customer: { name: 'Cafe Delta' },
            items: (args as unknown as { data: { items: { create: unknown[] } } }).data.items
              .create,
          });
        },
      },
      sale: {
        create: (args: { data: { id: string; total: number } }) => {
          calls.saleCreate.push(args);
          const items = (
            args as unknown as { data: { items: { create: { productId: string; qty: number }[] } } }
          ).data.items.create;
          return Promise.resolve({
            id: args.data.id,
            total: args.data.total,
            items: items.map((it, i) => ({ id: `item-${i}`, ...it })),
          });
        },
      },
      stockLotAllocation: {
        createMany: (args: unknown) => {
          calls.allocationCreateMany.push(args);
          return Promise.resolve({});
        },
      },
      transaction: {
        create: (args: unknown) => {
          calls.transactionCreate.push(args);
          return Promise.resolve({});
        },
      },
      auditLog: {
        create: (args: unknown) => {
          calls.auditCreate.push(args);
          return Promise.resolve({});
        },
      },
    };

    const prisma = {
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(tx),
    } as unknown as PrismaService;

    const ids = {
      next: (prefix: string) => Promise.resolve(prefix === 'INV' ? 'INV-0001' : 'SAL-001'),
    } as unknown as PrefixIdService;

    const recomputeCalls: string[] = [];
    const lots = {
      allocateFromWarehouse:
        opts.allocate ??
        ((_tx: unknown, productId: string, qty: number) =>
          Promise.resolve([{ stockEntryId: `STK-${productId}`, quantity: qty, unitCost: 10 }])),
      recomputeProductStock: (_tx: unknown, productId: string) => {
        recomputeCalls.push(productId);
        return Promise.resolve();
      },
    } as unknown as StockLotService;

    return { prisma, ids, lots, calls, recomputeCalls };
  }

  it('throws NotFoundException when the order does not exist', async () => {
    const { prisma, ids, lots } = makeMocks({ order: null });
    const svc = new DistributionOrdersService(prisma, ids, lots);
    await assert.rejects(
      svc.confirm('DOR-999', { lines: [{ productId: 'PRD-001', confirmedQty: 1, price: 10 }] }),
      NotFoundException,
    );
  });

  it('throws BadRequestException for a line not on the order', async () => {
    const { prisma, ids, lots } = makeMocks({ order: makeOrder() });
    const svc = new DistributionOrdersService(prisma, ids, lots);
    await assert.rejects(
      svc.confirm('DOR-001', { lines: [{ productId: 'PRD-999', confirmedQty: 1, price: 10 }] }),
      BadRequestException,
    );
  });

  it('throws BadRequestException when nothing is confirmed', async () => {
    const { prisma, ids, lots } = makeMocks({ order: makeOrder() });
    const svc = new DistributionOrdersService(prisma, ids, lots);
    await assert.rejects(
      svc.confirm('DOR-001', { lines: [{ productId: 'PRD-001', confirmedQty: 0, price: 10 }] }),
      BadRequestException,
    );
  });

  it('throws ConflictException when the order is no longer issued (double-confirm race)', async () => {
    const { prisma, ids, lots } = makeMocks({ order: makeOrder(), guardCount: 0 });
    const svc = new DistributionOrdersService(prisma, ids, lots);
    await assert.rejects(
      svc.confirm('DOR-001', { lines: [{ productId: 'PRD-001', confirmedQty: 5, price: 20 }] }),
      ConflictException,
    );
  });

  it('confirms only the requested lines: partial qty, invoice, sale, allocations, line updates', async () => {
    const { prisma, ids, lots, calls, recomputeCalls } = makeMocks({ order: makeOrder() });
    const svc = new DistributionOrdersService(prisma, ids, lots);

    // Requests 8 of PRD-001 (out of 10) and omits PRD-002 entirely.
    const result = await svc.confirm('DOR-001', {
      lines: [{ productId: 'PRD-001', confirmedQty: 8, price: 25 }],
    });

    assert.equal(result.total, 200); // 8 * 25
    assert.equal(result.items, 1);

    // Only one sale item / invoice item was created (PRD-002 not confirmed).
    const saleArgs = calls.saleCreate[0] as { data: { items: { create: unknown[] } } };
    assert.equal(saleArgs.data.items.create.length, 1);

    // Stock allocated only for the confirmed 8 units.
    const allocArgs = calls.allocationCreateMany[0] as { data: { quantity: number }[] };
    assert.equal(allocArgs.data.length, 1);
    assert.equal(allocArgs.data[0].quantity, 8);

    // Both lines get a DistributionOrderLine update: one confirmed, one zeroed out.
    assert.equal(calls.lineUpdate.length, 2);
    const zeroed = calls.lineUpdate.find(
      (c) => (c as { where: { id: string } }).where.id === 'line-2',
    ) as { data: { confirmedQty: number } };
    assert.equal(zeroed.data.confirmedQty, 0);

    // Order linked to the sale.
    assert.equal(calls.orderUpdate.length, 1);
    assert.equal((calls.orderUpdate[0] as { data: { saleId: string } }).data.saleId, 'SAL-001');

    assert.equal(calls.transactionCreate.length, 1);
    assert.equal(calls.auditCreate.length, 1);
    assert.deepEqual(recomputeCalls, ['PRD-001']);
  });

  it('propagates InsufficientStockException and stops before writing allocations', async () => {
    const { prisma, ids, lots, calls } = makeMocks({
      order: makeOrder(),
      allocate: () => Promise.reject(new InsufficientStockException(['PRD-001'])),
    });
    const svc = new DistributionOrdersService(prisma, ids, lots);
    await assert.rejects(
      svc.confirm('DOR-001', { lines: [{ productId: 'PRD-001', confirmedQty: 8, price: 25 }] }),
      InsufficientStockException,
    );
    assert.equal(calls.allocationCreateMany.length, 0);
    assert.equal(calls.lineUpdate.length, 0);
    assert.equal(calls.transactionCreate.length, 0);
  });
});

describe('DistributionOrdersService.cancel', () => {
  it('cancels an issued order', async () => {
    let updateManyArgs: unknown = null;
    const prisma = {
      distributionOrder: {
        updateMany: (args: unknown) => {
          updateManyArgs = args;
          return Promise.resolve({ count: 1 });
        },
        findFirst: () =>
          Promise.resolve({
            id: 'DOR-001',
            status: DistributionOrderStatus.cancelled,
            customer: { name: 'Cafe Delta' },
            lines: [],
          }),
      },
    } as unknown as PrismaService;
    const svc = new DistributionOrdersService(prisma, {} as PrefixIdService, {} as StockLotService);
    const result = await svc.cancel('DOR-001');
    assert.equal(result.status, DistributionOrderStatus.cancelled);
    assert.ok(updateManyArgs);
  });

  it('throws ConflictException when the order is not in issued state', async () => {
    const prisma = {
      distributionOrder: {
        updateMany: () => Promise.resolve({ count: 0 }),
        findFirst: () => Promise.resolve({ id: 'DOR-001' }),
      },
    } as unknown as PrismaService;
    const svc = new DistributionOrdersService(prisma, {} as PrefixIdService, {} as StockLotService);
    await assert.rejects(svc.cancel('DOR-001'), ConflictException);
  });

  it('throws NotFoundException when the order does not exist', async () => {
    const prisma = {
      distributionOrder: {
        updateMany: () => Promise.resolve({ count: 0 }),
        findFirst: () => Promise.resolve(null),
      },
    } as unknown as PrismaService;
    const svc = new DistributionOrdersService(prisma, {} as PrefixIdService, {} as StockLotService);
    await assert.rejects(svc.cancel('DOR-001'), NotFoundException);
  });
});
