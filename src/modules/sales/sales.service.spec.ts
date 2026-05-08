import * as assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, StockLotConsumerType } from '@prisma/client';
import { SalesService } from './sales.service';
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
