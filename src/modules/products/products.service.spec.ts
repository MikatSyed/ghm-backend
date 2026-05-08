import * as assert from 'node:assert/strict';
import { ProductsService } from './products.service';
import { ListProductsQueryDto } from './dto/list-products.query';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PrefixIdService } from '../../common/services/prefix-id.service';

describe('ProductsService.findAll', () => {
  function makePrismaMock() {
    const calls = { findMany: [] as unknown[], count: [] as unknown[], transaction: 0 };
    const product = {
      findMany: (args: unknown) => {
        calls.findMany.push(args);
        return Promise.resolve([{ id: 'PRD-001', name: 'Rice', stock: 10 }]);
      },
      count: (args: unknown) => {
        calls.count.push(args);
        return Promise.resolve(1);
      },
    };
    const prisma = {
      product,
      $transaction: () => {
        calls.transaction++;
        throw new Error('$transaction must not be called for list reads');
      },
    } as unknown as PrismaService;
    return { prisma, calls };
  }

  const ids = {} as PrefixIdService;

  function makeQuery(): ListProductsQueryDto {
    const q = new ListProductsQueryDto();
    q.page = 1;
    q.pageSize = 20;
    return q;
  }

  it('returns listResponse shape and never invokes $transaction', async () => {
    const { prisma, calls } = makePrismaMock();
    const svc = new ProductsService(prisma, ids);

    const out = await svc.findAll(makeQuery());

    assert.deepEqual(out, {
      data: [{ id: 'PRD-001', name: 'Rice', stock: 10 }],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    assert.equal(calls.transaction, 0);
    assert.equal(calls.findMany.length, 1);
    assert.equal(calls.count.length, 1);
  });

  it('passes the same where to findMany and count', async () => {
    const { prisma, calls } = makePrismaMock();
    const svc = new ProductsService(prisma, ids);
    const q = makeQuery();
    q.q = 'rice';

    await svc.findAll(q);

    const findManyArg = calls.findMany[0] as { where: unknown };
    const countArg = calls.count[0] as { where: unknown };
    assert.deepEqual(findManyArg.where, countArg.where);
  });

  it('example output', async () => {
    const { prisma } = makePrismaMock();
    const svc = new ProductsService(prisma, ids);
    const out = await svc.findAll(makeQuery());
    console.log('example findAll() output:', out);
    assert.equal(out.total, 1);
  });
});
