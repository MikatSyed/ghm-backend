import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, StockLotConsumerType } from '@prisma/client';
import { SalesService } from './sales.service';
import { InsufficientStockException } from '../../common/exceptions/insufficient-stock.exception';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PrefixIdService } from '../../common/services/prefix-id.service';
import type { StockLotService } from '../../common/services/stock-lot.service';

describe('SalesService.void', () => {
  function makeMocks(opts: {
    sale?: {
      id: string;
      total: number;
      invoiceId: string | null;
      items: Array<{ id: string; productId: string; qty: number }>;
      invoice: { status: InvoiceStatus } | null;
    } | null;
  }) {
    const reverseCalls: Array<{ consumerType: StockLotConsumerType; consumerId: string }> = [];
    const recomputeCalls: string[] = [];
    const txCalls = {
      saleUpdate: [] as unknown[],
      invoiceUpdate: [] as unknown[],
      transactionCreate: [] as unknown[],
      auditCreate: [] as unknown[],
    };

    const tx = {
      sale: {
        findFirst: () => Promise.resolve(opts.sale ?? null),
        update: (args: unknown) => {
          txCalls.saleUpdate.push(args);
          return Promise.resolve({});
        },
      },
      invoice: {
        update: (args: unknown) => {
          txCalls.invoiceUpdate.push(args);
          return Promise.resolve({});
        },
      },
      transaction: {
        create: (args: unknown) => {
          txCalls.transactionCreate.push(args);
          return Promise.resolve({});
        },
      },
      auditLog: {
        create: (args: unknown) => {
          txCalls.auditCreate.push(args);
          return Promise.resolve({});
        },
      },
    };

    const prisma = {
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(tx),
    } as unknown as PrismaService;

    const lots = {
      reverseAllocationsFor: (
        _tx: unknown,
        consumerType: StockLotConsumerType,
        consumerId: string,
      ) => {
        reverseCalls.push({ consumerType, consumerId });
        return Promise.resolve();
      },
      recomputeProductStock: (_tx: unknown, productId: string) => {
        recomputeCalls.push(productId);
        return Promise.resolve();
      },
    } as unknown as StockLotService;

    const ids = {} as PrefixIdService;
    return { prisma, lots, ids, reverseCalls, recomputeCalls, txCalls };
  }

  it('throws NotFoundException when sale not found', async () => {
    const { prisma, lots, ids } = makeMocks({ sale: null });
    const svc = new SalesService(prisma, ids, lots);
    await assert.rejects(svc.void('SAL-999'), NotFoundException);
  });

  it('throws ConflictException when invoice is already paid', async () => {
    const { prisma, lots, ids } = makeMocks({
      sale: {
        id: 'SAL-001',
        total: 1000,
        invoiceId: 'INV-001',
        items: [{ id: 'item-1', productId: 'PRD-001', qty: 5 }],
        invoice: { status: InvoiceStatus.paid },
      },
    });
    const svc = new SalesService(prisma, ids, lots);
    await assert.rejects(svc.void('SAL-001'), ConflictException);
  });

  it('reverses allocations, soft-deletes sale + invoice, writes negative txn', async () => {
    const { prisma, lots, ids, reverseCalls, recomputeCalls, txCalls } = makeMocks({
      sale: {
        id: 'SAL-001',
        total: 1500,
        invoiceId: 'INV-001',
        items: [
          { id: 'item-1', productId: 'PRD-001', qty: 5 },
          { id: 'item-2', productId: 'PRD-002', qty: 3 },
          { id: 'item-3', productId: 'PRD-001', qty: 2 },
        ],
        invoice: { status: InvoiceStatus.unpaid },
      },
    });
    const svc = new SalesService(prisma, ids, lots);
    const out = await svc.void('SAL-001');

    // one reversal per item
    assert.equal(reverseCalls.length, 3);
    assert.deepEqual(reverseCalls[0], {
      consumerType: StockLotConsumerType.SALE_ITEM,
      consumerId: 'item-1',
    });

    // soft-delete invoice + sale
    assert.equal(txCalls.invoiceUpdate.length, 1);
    assert.equal(txCalls.saleUpdate.length, 1);
    const saleArg = txCalls.saleUpdate[0] as { data: { deletedAt: Date } };
    assert.ok(saleArg.data.deletedAt instanceof Date);

    // reversing transaction (negative amount)
    assert.equal(txCalls.transactionCreate.length, 1);
    const txnArg = txCalls.transactionCreate[0] as { data: { amount: number } };
    assert.equal(txnArg.data.amount, -1500);

    // audit log
    assert.equal(txCalls.auditCreate.length, 1);

    // recompute called once per unique product (PRD-001, PRD-002 → 2 calls)
    assert.equal(recomputeCalls.length, 2);

    assert.deepEqual(out, { id: 'SAL-001', voided: true, productsAffected: 2 });
  });

  it('handles sale without invoice gracefully', async () => {
    const { prisma, lots, ids, txCalls } = makeMocks({
      sale: {
        id: 'SAL-002',
        total: 500,
        invoiceId: null,
        items: [{ id: 'item-1', productId: 'PRD-001', qty: 1 }],
        invoice: null,
      },
    });
    const svc = new SalesService(prisma, ids, lots);
    await svc.void('SAL-002');
    assert.equal(txCalls.invoiceUpdate.length, 0);
    assert.equal(txCalls.saleUpdate.length, 1);
  });
});

describe('SalesService.direct', () => {
  function makeMocks(opts: {
    customer?: { id: string; name: string; deletedAt: null } | null;
    products?: { id: string; name: string }[];
    allocate?: (
      productId: string,
      qty: number,
    ) => Promise<{ stockEntryId: string; quantity: number; unitCost: number }[]>;
  }) {
    const calls = {
      invoiceCreate: [] as unknown[],
      saleCreate: [] as unknown[],
      allocationCreateMany: [] as unknown[],
      transactionCreate: [] as unknown[],
      auditCreate: [] as unknown[],
    };
    const recomputeCalls: string[] = [];

    const tx = {
      customer: { findFirst: () => Promise.resolve(opts.customer ?? null) },
      product: { findMany: () => Promise.resolve(opts.products ?? []) },
      invoice: {
        create: (args: { data: { id: string; total: number } }) => {
          calls.invoiceCreate.push(args);
          return Promise.resolve({
            id: args.data.id,
            date: new Date('2026-04-18'),
            total: args.data.total,
            status: InvoiceStatus.unpaid,
            customerId: 'CUS-001',
            customer: { name: opts.customer?.name ?? 'Direct Buyer' },
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

    const lots = {
      allocateFromWarehouse:
        opts.allocate ??
        ((_tx: unknown, productId: string, qty: number) =>
          Promise.resolve([{ stockEntryId: `STK-${productId}`, quantity: qty, unitCost: 15 }])),
      recomputeProductStock: (_tx: unknown, productId: string) => {
        recomputeCalls.push(productId);
        return Promise.resolve();
      },
    } as unknown as StockLotService;

    return { prisma, ids, lots, calls, recomputeCalls };
  }

  it('throws BadRequestException for an unknown customer', async () => {
    const { prisma, ids, lots } = makeMocks({ customer: null });
    const svc = new SalesService(prisma, ids, lots);
    await assert.rejects(
      svc.direct({
        customerId: 'CUS-999',
        date: '2026-04-18',
        items: [{ productId: 'PRD-001', price: 50, qty: 2 }],
      }),
      BadRequestException,
    );
  });

  it('throws BadRequestException for an unknown product', async () => {
    const { prisma, ids, lots } = makeMocks({
      customer: { id: 'CUS-001', name: 'Direct Buyer', deletedAt: null },
      products: [],
    });
    const svc = new SalesService(prisma, ids, lots);
    await assert.rejects(
      svc.direct({
        customerId: 'CUS-001',
        date: '2026-04-18',
        items: [{ productId: 'PRD-001', price: 50, qty: 2 }],
      }),
      BadRequestException,
    );
  });

  it('consumes warehouse FIFO lots straight to SALE_ITEM and creates invoice', async () => {
    const { prisma, ids, lots, calls, recomputeCalls } = makeMocks({
      customer: { id: 'CUS-001', name: 'Direct Buyer', deletedAt: null },
      products: [{ id: 'PRD-001', name: 'Tomato' }],
    });
    const svc = new SalesService(prisma, ids, lots);
    const result = await svc.direct({
      customerId: 'CUS-001',
      date: '2026-04-18',
      items: [{ productId: 'PRD-001', price: 50, qty: 4 }],
    });

    assert.equal(result.total, 200);
    assert.equal(result.customerId, 'CUS-001');

    const allocArgs = calls.allocationCreateMany[0] as {
      data: { consumerType: StockLotConsumerType; quantity: number }[];
    };
    assert.equal(allocArgs.data.length, 1);
    assert.equal(allocArgs.data[0].consumerType, StockLotConsumerType.SALE_ITEM);
    assert.equal(allocArgs.data[0].quantity, 4);

    assert.equal(calls.transactionCreate.length, 1);
    assert.equal(calls.auditCreate.length, 1);
    assert.deepEqual(recomputeCalls, ['PRD-001']);
  });

  it('propagates InsufficientStockException from allocateFromWarehouse', async () => {
    const { prisma, ids, lots } = makeMocks({
      customer: { id: 'CUS-001', name: 'Direct Buyer', deletedAt: null },
      products: [{ id: 'PRD-001', name: 'Tomato' }],
      allocate: () => Promise.reject(new InsufficientStockException(['PRD-001'])),
    });
    const svc = new SalesService(prisma, ids, lots);
    await assert.rejects(
      svc.direct({
        customerId: 'CUS-001',
        date: '2026-04-18',
        items: [{ productId: 'PRD-001', price: 50, qty: 999 }],
      }),
      InsufficientStockException,
    );
  });
});
