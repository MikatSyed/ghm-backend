# GHM Server — Drizzle ORM Migration LLD

**Author:** Architecture review
**Date:** 2026-04-25
**Status:** Proposal
**Scope:** Migrate `src/` from Prisma 5 → Drizzle ORM, address API latency complaints

---

## 0. TL;DR — Read this first

Bro, honest assessment age boli:

1. **API slow keno?** ORM-er fault na (mostly). Asol problem code patterns —
   N+1 loops, sequential `await` inside transactions, per-item `recomputeProductStock` calls, per-van aggregation loops in dashboard/accounting/reports. Drizzle e shift korleo same code structure thakle same slowness thakbe.

2. **Drizzle migration ki tao kora uchit?** Yes, but karon onno —
   - Lower per-query overhead (~5–10× faster planning, no proxy)
   - Direct SQL access (raw query likhte parba easily for hot paths)
   - Smaller bundle, faster cold start
   - Better batch insert support (`insert().values([...])` single statement)
   - No `prisma generate` step, no client regen friction
   - Type inference from schema, no codegen

3. **Recommended order:**
   - **Phase 0 (1–2 din):** Fix the actual perf bugs in current Prisma code. Big win, low risk.
   - **Phase 1 (1 din):** Drizzle setup, POC on smallest module (`vans` or `categories`).
   - **Phase 2–4 (1–2 sopto):** Module-by-module migration in dependency order.
   - **Phase 5 (1 din):** Drop Prisma, update CI.

4. **Cost:** ~2 sopto for full migration if done module-by-module. Phase 0 alone deliver 60–80% of perf improvement in 2 din.

---

## 1. Current Architecture Snapshot

| Component | Detail |
|---|---|
| ORM | Prisma 5 |
| DB | PostgreSQL |
| Framework | NestJS 10 |
| Entry point | `src/prisma/prisma.service.ts` (extends PrismaClient) |
| Models | 17 (User, Category, Product, Van, StockEntry, StockLotAllocation, StockAdjustment, Distribution, DistributionLine, Sale, SaleItem, Invoice, InvoiceItem, Expense, Transaction, AuditLog, IdSequence) |
| Enums | 10 (re-exported via `@prisma/client` to DTOs) |
| Migrations | 5 in `prisma/migrations/` |
| Tests | None |
| Connection pool | Default Prisma (10 conns) — no explicit tuning |

### 1.1 Prisma touchpoints

- `PrismaService` injected in 14 services
- `prisma.$transaction(...)` called in 11 places (5 interactive, 6 array-mode)
- `Prisma.TransactionClient` type used in 2 utility services (`stock-lot.service.ts`, `prefix-id.service.ts`)
- 10 DTOs import enums from `@prisma/client`
- `Prisma.PrismaClientKnownRequestError` caught in `all-exceptions.filter.ts`
- `Prisma.InputJsonValue` used in `products.service.ts` for audit JSON

---

## 2. Root Cause Analysis — Why APIs are slow

### 2.1 The 5s timeout in stock-adjustments

**Location:** `src/modules/stock-adjustments/stock-adjustments.service.ts:37`

Worst-case query count inside the transaction:
```
1  findFirst (product)
1  findFirst (van, conditional)
1  upsert    (IdSequence — every TX hits this)
1  create    (StockAdjustment)
1  findMany  (allocateFromWarehouse / allocateFromVan)
N  update    (StockEntry.remainingQuantity, one per slice — sequential)
K  create    (StockLotAllocation, one per slice — sequential)
2  aggregate (recomputeProductStock — warehouse + van sum)
1  update    (Product.stock)
1  create    (Transaction)
```

For a typical adjustment with 3–5 FIFO slices: **15–20 sequential round-trips**. At 50–100ms latency each (managed PG, network round-trip), that's 1–2s. Add connection contention from concurrent requests → 5s timeout.

### 2.2 Hotspots beyond stock-adjustments

| Service | Method | Issue | Worst-case queries |
|---|---|---|---|
| `sales.service.ts` | `finalize()` | Per-item `allocateFromVan` + per-item `recomputeProductStock` + redundant invoice re-fetch | **30+** |
| `distributions.service.ts` | `create()` | Per-line `allocateFromWarehouse` + per-line `recompute` | **20+** |
| `distributions.service.ts` | `removeLine()` | N+1 `count()` per allocation | **2M + 4** |
| `vans.service.ts` | `findAll()` | `Promise.all(vans.map(todaySummary))` — 2 queries per van | **1 + 2V** |
| `dashboard.service.ts` | `vanPerformance()` | 2 aggregates per van | **2V** |
| `dashboard.service.ts` | `categoryBreakdown()` | Unbounded `invoiceItem.findMany()` with full nested includes | **1 (huge payload)** |
| `accounting.service.ts` | `vanProfitability()` | 2 aggregates per van | **2V** |
| `reports.service.ts` | `profitByVan()` | 2 aggregates per van | **2V** |
| `categories.service.ts` | daily stats | Nested `include: { products: { include: { saleItems } } }` — full hydration | **1 (huge payload)** |

**Verdict:** All of these are N+1 / overfetch problems. Drizzle won't fix them automatically. Fix them at the SQL/code level.

### 2.3 Things Drizzle *does* improve

- **Per-query overhead.** Prisma's query engine is a Rust subprocess; every query crosses a JSON-RPC boundary. Drizzle compiles to direct `pg` driver calls. Saves ~5–10ms per query — for a 30-query transaction, that's 150–300ms baseline win.
- **Batch insert.** Prisma's `createMany` doesn't support `include`/return, and nested writes can't batch. Drizzle's `insert().values([...]).returning()` is one statement.
- **Raw SQL ergonomics.** When a hot path needs a CTE or window function, Drizzle's `sql\`...\`` is type-safe and inline. Prisma needs `$queryRaw` + manual types.
- **No codegen.** No `prisma generate` step. Schema changes are TS-only.
- **Smaller deploy artifact.** ~50MB Prisma engine binary gone.

---

## 3. Recommended Strategy

### Two parallel tracks

**Track A — Perf fixes (Prisma stays):** Land immediately. Don't wait for migration.

**Track B — Drizzle migration:** Module-by-module, behind a feature seam (the `PrismaService` and `StockLotService` interfaces).

This way, you ship perf wins this week, and the migration progresses in the background without blocking features.

---

## 4. Phase 0 — Perf fixes (do these first, regardless of ORM choice)

### 4.1 Batch lot allocations (biggest single win)

**File:** `src/common/services/stock-lot.service.ts`

Add a method that combines findMany + updates in batched form:

```typescript
async allocateFromWarehouseBatched(
  tx: Tx,
  productId: string,
  quantity: number,
): Promise<WarehouseSlice[]> {
  if (quantity <= 0) return [];
  const lots = await tx.stockEntry.findMany({
    where: { productId, deletedAt: null, remainingQuantity: { gt: 0 } },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    select: { id: true, remainingQuantity: true, buyingRate: true },
  });

  const slices: WarehouseSlice[] = [];
  let needed = quantity;
  for (const lot of lots) {
    if (needed <= 0) break;
    const take = Math.min(lot.remainingQuantity, needed);
    slices.push({ stockEntryId: lot.id, quantity: take, unitCost: lot.buyingRate });
    needed -= take;
  }
  if (needed > 0) throw new InsufficientStockException([productId]);

  // Parallelize the updates — they're independent rows
  await Promise.all(
    slices.map((s) =>
      tx.stockEntry.update({
        where: { id: s.stockEntryId },
        data: { remainingQuantity: { decrement: s.quantity } },
      }),
    ),
  );
  return slices;
}
```

**Same pattern** for the `for (const s of slices)` create loops in `stock-adjustments`, `sales`, `distributions`. Wrap in `Promise.all`.

### 4.2 Use `createMany` for StockLotAllocation inserts

```typescript
await tx.stockLotAllocation.createMany({
  data: slices.map((s) => ({
    stockEntryId: s.stockEntryId,
    consumerType: StockLotConsumerType.STOCK_ADJUSTMENT,
    consumerId: adjustment.id,
    quantity: s.quantity,
    unitCost: s.unitCost,
  })),
});
```

One statement instead of N. (Note: `createMany` doesn't return rows — if you need IDs, keep individual `create` but parallelize.)

### 4.3 Deduplicate `recomputeProductStock` calls

In `sales.finalize()` and `distributions.create()`:

```typescript
const productIds = new Set(items.map((i) => i.productId));
// ... do all allocations in parallel
await Promise.all([...productIds].map((pid) => this.lots.recomputeProductStock(tx, pid)));
```

Currently called once per item; should be once per **unique** product, and parallelizable.

### 4.4 Fix the N+1 in `removeLine`

**File:** `src/modules/distributions/distributions.service.ts:184`

Replace per-allocation `count()` with one batched query:

```typescript
const allocs = await tx.stockLotAllocation.findMany({
  where: { consumerType: 'DISTRIBUTION_LINE', consumerId: line.id },
});
const allocIds = allocs.map((a) => a.id);
const childCounts = await tx.stockLotAllocation.groupBy({
  by: ['parentAllocationId'],
  where: { parentAllocationId: { in: allocIds } },
  _count: true,
});
const childMap = new Map(childCounts.map((c) => [c.parentAllocationId, c._count]));
for (const a of allocs) {
  if ((childMap.get(a.id) ?? 0) > 0) throw new InsufficientStockException(...);
  // ...
}
```

### 4.5 Fix per-van aggregation loops

**Files:** `dashboard.service.ts:122`, `accounting.service.ts:44`, `reports.service.ts:98`, `vans.service.ts:10`

Replace V loops of 2 aggregates with a single `groupBy('vanId')`:

```typescript
const revenue = await this.prisma.invoice.groupBy({
  by: ['vanId'],
  where: { date: { gte: start, lte: end }, deletedAt: null },
  _sum: { total: true },
});
const cost = await this.prisma.distributionLine.groupBy({
  by: ['distribution.vanId'], // not directly supported, use raw or join via includes
  where: { distribution: { date: { gte, lte }, deletedAt: null } },
  _sum: { allocated: true },
});
```

Where Prisma's `groupBy` is awkward (cross-relation), drop to `$queryRaw` for a single aggregating query. **This converts 2V queries into 2.**

### 4.6 Add limits and selects

- `dashboard.service.ts:150` — `categoryBreakdown` fetches ALL invoiceItems. Add date filter + use `groupBy` + `_sum`.
- `categories.service.ts:52` — daily stats nested include — switch to aggregating query.
- `products.service.ts:129` — history queries: add `select: { id, date, quantity, ... }` to drop unused columns.

### 4.7 Connection pool tuning

**File:** `src/prisma/prisma.service.ts`

Append `?connection_limit=20&pool_timeout=10` to DATABASE_URL, or set `connection_limit` per environment. Default 10 is too low if you have any concurrent traffic.

### 4.8 Add slow query logging in dev

```typescript
log: [
  { emit: 'event', level: 'query' },
  { emit: 'event', level: 'error' },
],
```
Then `this.$on('query', (e) => { if (e.duration > 200) logger.warn(...) })`. Surfaces hotspots empirically.

**Expected impact of Phase 0:** 60–80% latency reduction on hot endpoints. The 5s timeout disappears.

---

## 5. Phase 1 — Drizzle setup & POC

### 5.1 Install

```bash
npm i drizzle-orm pg
npm i -D drizzle-kit @types/pg
```

### 5.2 Folder layout (additive — sits next to Prisma)

```
src/
  db/
    schema/
      index.ts            # re-exports all tables + enums
      users.ts
      categories.ts
      products.ts
      vans.ts
      stock-entries.ts
      stock-lot-allocations.ts
      stock-adjustments.ts
      distributions.ts
      sales.ts
      invoices.ts
      expenses.ts
      transactions.ts
      audit-logs.ts
      id-sequences.ts
      enums.ts            # all pgEnum() declarations
    drizzle.service.ts    # NestJS provider, equivalent to PrismaService
    drizzle.module.ts
    types.ts              # InferSelectModel / InferInsertModel exports
drizzle.config.ts         # drizzle-kit config (root)
```

### 5.3 `drizzle.config.ts`

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  // Important: introspect existing DB so we don't recreate tables
  introspect: { casing: 'preserve' },
});
```

**Critical:** Run `drizzle-kit introspect` against your existing DB first — it generates schema files matching the live tables. Then commit those files. From that point, schema is owned by Drizzle.

### 5.4 `DrizzleService`

```typescript
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

@Injectable()
export class DrizzleService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;
  public db!: NodePgDatabase<typeof schema>;
  private readonly logger = new Logger(DrizzleService.name);

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.pool = new Pool({
      connectionString: this.config.get('database.url'),
      max: 20,
      idleTimeoutMillis: 30_000,
    });
    this.db = drizzle(this.pool, { schema, logger: process.env.NODE_ENV !== 'production' });
    await this.pool.query('SELECT 1'); // smoke test
    this.logger.log('Drizzle connected');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
```

### 5.5 POC module choice

Migrate **`vans`** first. Reasons:
- Smallest service (`vans.service.ts` is ~60 lines)
- No interactive transactions
- Has the per-van loop bottleneck — good showcase for groupBy improvement
- No downstream services depend on it for stock math

Acceptance: `GET /api/v1/vans` p95 latency drops by ≥40%, all DTO contracts unchanged.

---

## 6. Phase 2 — Schema mapping reference

### 6.1 Field type translation

| Prisma | Drizzle | Notes |
|---|---|---|
| `String @id` (manual ID like `STK-001`) | `text('id').primaryKey()` | Keep IdSequence pattern |
| `String @id @default(uuid())` | `uuid('id').primaryKey().defaultRandom()` | UUID v4 default |
| `Int` | `integer('col')` | All money/qty stay integer (BDT no-decimal convention) |
| `String` | `text('col')` | No varchar limits used in current schema |
| `Boolean` | `boolean('col')` | |
| `DateTime` | `timestamp('col', { precision: 3, mode: 'date' })` | Match Prisma's TIMESTAMP(3) |
| `DateTime @db.Date` | `date('col', { mode: 'date' })` | Returns JS Date — wrap with `parseDhakaDateOnly` in service layer |
| `Json` | `jsonb('col').$type<MyType>()` | Use `$type<>()` for typed JSONB |
| Prisma enum | `pgEnum('name', [...])` | Declared in `enums.ts`, used as `.references(...)` for column type |
| `@unique` | `.unique()` on column | |
| `@@unique([a, b])` | `uniqueIndex(...)` in `(table) => ({...})` | |
| `@@index([a, b])` | `index(...)` in `(table) => ({...})` | |
| `@updatedAt` | Manual `.$onUpdate(() => new Date())` | Drizzle has this hook |
| `deletedAt DateTime?` | `timestamp('deleted_at')` (nullable) | Soft-delete pattern preserved in service layer |

### 6.2 Example: `StockEntry` table

```typescript
// src/db/schema/stock-entries.ts
import { pgTable, text, integer, timestamp, date, index } from 'drizzle-orm/pg-core';
import { products } from './products';

export const stockEntries = pgTable(
  'stock_entries',
  {
    id: text('id').primaryKey(),
    date: date('date', { mode: 'date' }).notNull(),
    productId: text('productId')
      .notNull()
      .references(() => products.id),
    quantity: integer('quantity').notNull(),
    remainingQuantity: integer('remainingQuantity').notNull(),
    expiryDate: date('expiryDate', { mode: 'date' }),
    buyingRate: integer('buyingRate').notNull(),
    source: text('source').notNull(),
    notes: text('notes'),
    createdAt: timestamp('createdAt', { precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deletedAt', { precision: 3 }),
  },
  (t) => ({
    productIdx: index('stock_entries_productId_idx').on(t.productId),
    dateIdx: index('stock_entries_date_idx').on(t.date),
    productRemainingIdx: index('stock_entries_productId_remainingQuantity_idx').on(
      t.productId,
      t.remainingQuantity,
    ),
  }),
);

export type StockEntry = typeof stockEntries.$inferSelect;
export type NewStockEntry = typeof stockEntries.$inferInsert;
```

### 6.3 Example: enum

```typescript
// src/db/schema/enums.ts
import { pgEnum } from 'drizzle-orm/pg-core';

export const stockAdjustmentReasonEnum = pgEnum('StockAdjustmentReason', [
  'DAMAGE',
  'WASTAGE',
  'CORRECTION',
]);

export const stockLocationEnum = pgEnum('StockLocation', ['WAREHOUSE', 'VAN']);

// ... others

// Re-export string-union types for DTOs
export type StockAdjustmentReason = (typeof stockAdjustmentReasonEnum.enumValues)[number];
export type StockLocation = (typeof stockLocationEnum.enumValues)[number];
```

DTOs change from:
```typescript
import { StockAdjustmentReason } from '@prisma/client';
@IsEnum(StockAdjustmentReason)
```
to:
```typescript
import { stockAdjustmentReasonEnum } from '../../../db/schema/enums';
@IsIn(stockAdjustmentReasonEnum.enumValues)
```

---

## 7. Phase 3 — Service migration patterns

### 7.1 Pattern: simple findFirst

```typescript
// Prisma
const product = await tx.product.findFirst({
  where: { id: dto.productId, deletedAt: null },
});

// Drizzle
import { and, eq, isNull } from 'drizzle-orm';

const [product] = await tx
  .select()
  .from(products)
  .where(and(eq(products.id, dto.productId), isNull(products.deletedAt)))
  .limit(1);
```

### 7.2 Pattern: paginated list with filters

```typescript
// Prisma
const where: Prisma.StockAdjustmentWhereInput = { deletedAt: null, ... };
const [items, total] = await this.prisma.$transaction([
  this.prisma.stockAdjustment.findMany({ where, skip, take, orderBy, include: {...} }),
  this.prisma.stockAdjustment.count({ where }),
]);

// Drizzle — build conditions dynamically
const conditions = [isNull(stockAdjustments.deletedAt)];
if (q.productId) conditions.push(eq(stockAdjustments.productId, q.productId));
if (q.dateFrom) conditions.push(gte(stockAdjustments.date, parseDhakaDateOnly(q.dateFrom)));

const items = await this.db
  .select({
    id: stockAdjustments.id,
    date: stockAdjustments.date,
    quantity: stockAdjustments.quantity,
    productName: products.name,
    productUnit: products.unit,
    vanName: vans.vanName,
  })
  .from(stockAdjustments)
  .leftJoin(products, eq(stockAdjustments.productId, products.id))
  .leftJoin(vans, eq(stockAdjustments.vanId, vans.id))
  .where(and(...conditions))
  .orderBy(desc(stockAdjustments.date))
  .limit(q.take)
  .offset(q.skip);

const [{ count }] = await this.db
  .select({ count: sql<number>`count(*)::int` })
  .from(stockAdjustments)
  .where(and(...conditions));
```

### 7.3 Pattern: interactive transaction

```typescript
// Prisma
return this.prisma.$transaction(
  async (tx) => { ... },
  { timeout: 20000, maxWait: 5000 },
);

// Drizzle
return this.db.transaction(async (tx) => {
  // tx is fully typed, same API as this.db
  // ...
});
// Note: Drizzle uses pg's BEGIN/COMMIT, no built-in timeout.
// Set statement_timeout in connection: ?statement_timeout=20000
```

### 7.4 Pattern: aggregate

```typescript
// Prisma
const agg = await tx.stockEntry.aggregate({
  where: { productId, deletedAt: null },
  _sum: { remainingQuantity: true },
});
const total = agg._sum.remainingQuantity ?? 0;

// Drizzle
import { sum } from 'drizzle-orm';

const [{ total }] = await tx
  .select({ total: sum(stockEntries.remainingQuantity).mapWith(Number) })
  .from(stockEntries)
  .where(and(eq(stockEntries.productId, productId), isNull(stockEntries.deletedAt)));
```

### 7.5 Pattern: groupBy (the per-van loop killer)

```typescript
// Drizzle — replace V loops with one query
const vanRevenue = await this.db
  .select({
    vanId: invoices.vanId,
    revenue: sum(invoices.total).mapWith(Number),
  })
  .from(invoices)
  .where(
    and(
      gte(invoices.date, start),
      lte(invoices.date, end),
      isNull(invoices.deletedAt),
    ),
  )
  .groupBy(invoices.vanId);
```

### 7.6 Pattern: batch insert with returning

```typescript
// Prisma — couldn't return inserted rows in batch
await tx.stockLotAllocation.createMany({ data: slices.map(...) });

// Drizzle — single statement, returns rows
const inserted = await tx
  .insert(stockLotAllocations)
  .values(
    slices.map((s) => ({
      stockEntryId: s.stockEntryId,
      consumerType: 'STOCK_ADJUSTMENT',
      consumerId: adjustment.id,
      quantity: s.quantity,
      unitCost: s.unitCost,
    })),
  )
  .returning();
```

### 7.7 Pattern: raw SQL when needed

```typescript
import { sql } from 'drizzle-orm';

const result = await this.db.execute(sql`
  SELECT v.id, v."vanName",
         COALESCE(SUM(i.total), 0)::int as revenue,
         COALESCE(SUM(dl.allocated * se."buyingRate"), 0)::int as cost
  FROM vans v
  LEFT JOIN invoices i ON i."vanId" = v.id AND i.date BETWEEN ${start} AND ${end}
  LEFT JOIN distributions d ON d."vanId" = v.id AND d.date BETWEEN ${start} AND ${end}
  LEFT JOIN distribution_lines dl ON dl."distributionId" = d.id
  LEFT JOIN stock_entries se ON se.id = dl."productId"  -- adjust for FIFO cost
  WHERE v."deletedAt" IS NULL
  GROUP BY v.id, v."vanName"
`);
```

---

## 8. Phase 3 — Module migration order

Migrate bottom-up by dependency. Each module is self-contained; ship after each.

| # | Module | Why this order | Risk |
|---|---|---|---|
| 1 | `vans` | No deps, smallest service, perf hotspot for POC | Low |
| 2 | `categories` | No deps; daily-stats query needs raw SQL | Low |
| 3 | `expenses` | No stock-affecting logic | Low |
| 4 | `products` + `prefix-id` service | All other stock modules depend on prefix-id | Medium |
| 5 | `stock-entries` | Depends on products; simple TX | Medium |
| 6 | `stock-lot.service.ts` (the core) | Depends on stock-entries; touched by every stock op | **High** |
| 7 | `stock-adjustments` | Depends on stock-lot | High |
| 8 | `distributions` | Depends on stock-lot | High |
| 9 | `sales` | Depends on stock-lot, distributions | High |
| 10 | `invoices` | Depends on sales | Medium |
| 11 | `dashboard`, `accounting`, `reports`, `search` | Read-only aggregations; can be migrated in parallel | Medium |
| 12 | `auth`, `users` | Independent, can go anytime | Low |
| 13 | Cleanup: drop Prisma | After all modules done | Low |

### Co-existence strategy

During migration, **both `PrismaService` and `DrizzleService` exist**. Each service injects only what it needs. This works because Prisma and Drizzle hit the same database — the only constraint is that schema migrations must remain compatible (both generate the same DDL).

**Schema ownership:** Until cutover, **Prisma owns migrations**. Drizzle is read-only on schema (`drizzle-kit introspect` only). After cutover, switch ownership to `drizzle-kit generate` + `drizzle-kit push`.

---

## 9. Phase 4 — Patterns for the heaviest service

### 9.1 Rewriting `stock-lot.service.ts` with Drizzle + perf fixes

```typescript
// src/db/services/stock-lot.service.ts
import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { DrizzleService } from '../drizzle.service';
import {
  stockEntries,
  stockLotAllocations,
} from '../schema';
import { InsufficientStockException } from '../../common/exceptions/insufficient-stock.exception';

type Tx = Parameters<Parameters<DrizzleService['db']['transaction']>[0]>[0];

@Injectable()
export class StockLotService {
  constructor(private readonly drizzle: DrizzleService) {}

  async allocateFromWarehouse(tx: Tx, productId: string, quantity: number) {
    if (quantity <= 0) return [];

    const lots = await tx
      .select({
        id: stockEntries.id,
        remainingQuantity: stockEntries.remainingQuantity,
        buyingRate: stockEntries.buyingRate,
      })
      .from(stockEntries)
      .where(
        and(
          eq(stockEntries.productId, productId),
          isNull(stockEntries.deletedAt),
          gt(stockEntries.remainingQuantity, 0),
        ),
      )
      .orderBy(stockEntries.date, stockEntries.id);

    const slices: Array<{ stockEntryId: string; quantity: number; unitCost: number }> = [];
    let needed = quantity;
    for (const lot of lots) {
      if (needed <= 0) break;
      const take = Math.min(lot.remainingQuantity, needed);
      slices.push({ stockEntryId: lot.id, quantity: take, unitCost: lot.buyingRate });
      needed -= take;
    }
    if (needed > 0) throw new InsufficientStockException([productId]);

    // Parallel decrements — independent rows, safe
    await Promise.all(
      slices.map((s) =>
        tx
          .update(stockEntries)
          .set({ remainingQuantity: sql`${stockEntries.remainingQuantity} - ${s.quantity}` })
          .where(eq(stockEntries.id, s.stockEntryId)),
      ),
    );
    return slices;
  }

  async recomputeProductStock(tx: Tx, productId: string) {
    // Single query: warehouse + van sum via UNION ALL
    const [{ total }] = await tx.execute<{ total: number }>(sql`
      SELECT COALESCE((
        SELECT SUM("remainingQuantity")::int
        FROM stock_entries
        WHERE "productId" = ${productId} AND "deletedAt" IS NULL
      ), 0) + COALESCE((
        SELECT SUM(sla."remainingQuantity")::int
        FROM stock_lot_allocations sla
        JOIN stock_entries se ON se.id = sla."stockEntryId"
        WHERE sla."consumerType" = 'DISTRIBUTION_LINE'
          AND se."productId" = ${productId}
      ), 0) as total
    `);

    await tx
      .update(products)
      .set({ stock: total ?? 0 })
      .where(eq(products.id, productId));
  }

  // Variant: recompute many products in one shot (used by sales/distributions)
  async recomputeManyProductStocks(tx: Tx, productIds: string[]) {
    if (productIds.length === 0) return;
    await tx.execute(sql`
      WITH totals AS (
        SELECT p.id,
          COALESCE((
            SELECT SUM("remainingQuantity")::int
            FROM stock_entries
            WHERE "productId" = p.id AND "deletedAt" IS NULL
          ), 0) +
          COALESCE((
            SELECT SUM(sla."remainingQuantity")::int
            FROM stock_lot_allocations sla
            JOIN stock_entries se ON se.id = sla."stockEntryId"
            WHERE sla."consumerType" = 'DISTRIBUTION_LINE'
              AND se."productId" = p.id
          ), 0) as total
        FROM products p
        WHERE p.id IN ${productIds}
      )
      UPDATE products
      SET stock = totals.total
      FROM totals
      WHERE products.id = totals.id
    `);
  }
}
```

**Net effect on stock-adjustments TX:**
- Before: 15+ sequential queries, 1–2s
- After: ~6 queries (1 product check + 1 allocate findMany + 1 batch insert + 1 recompute raw + 1 transaction insert), parallelized — **<300ms**

---

## 10. Phase 5 — Cutover & cleanup

1. **Verify all routes** behave identically with Drizzle. Manually run every endpoint, diff JSON response shape.
2. **Switch schema ownership** to Drizzle:
   - `npm run drizzle:generate` to produce baseline migration
   - Compare against Prisma's last applied migration — should be empty
   - From now on, schema changes go through `drizzle-kit`
3. **Remove Prisma:**
   - `npm uninstall @prisma/client prisma`
   - Delete `src/prisma/`, `prisma/schema.prisma`
   - Keep `prisma/migrations/` as historical record (or move to `_prisma_archive/`)
4. **Update CI:** replace `prisma generate` with no-op (Drizzle has no codegen)
5. **Update CLAUDE/PROJECT_CONTEXT.md** to reflect Drizzle stack
6. **Production rollout:** deploy + watch error rate / latency for 24h

---

## 11. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Schema drift between Prisma & Drizzle during co-existence | Medium | High | Keep Prisma as schema authority until cutover; introspect-only on Drizzle side |
| Date/timezone bugs (Prisma `@db.Date` vs Drizzle `date()`) | Medium | High | Write a snapshot test on day-boundary functions before & after migration of one date-heavy module |
| Enum value mismatch in DTOs | Low | Medium | Centralize enum re-export in `db/schema/enums.ts`; replace `@prisma/client` imports module-by-module |
| Exception filter no longer catches Prisma errors | Low | Medium | After last module migrates, swap filter to handle `pg` driver errors (`error.code === '23505'` etc.) |
| Performance regression because raw SQL not equivalent | Medium | Medium | EXPLAIN ANALYZE on every raw SQL added; add a perf test for stock-adjustments TX (target: p95 < 500ms) |
| Lost type safety on relations | Low | Low | Use Drizzle's relational query API (`db.query.x.findMany({ with: {...} })`) for nested fetches |
| Connection pool exhaustion under load | Medium | High | Set pool size = `(num_app_instances × concurrent_requests_per_instance)`; monitor `pg_stat_activity` |
| Migration takes longer than estimated | High | Low | Phase 0 ships immediately and is independently valuable. If Drizzle migration stalls, you've still won |

---

## 12. Decision matrix — Should you actually switch?

| Factor | Stay on Prisma | Switch to Drizzle |
|---|---|---|
| Per-query latency overhead | ~5ms | ~0.5ms |
| Bundle size | +50MB engine | +1MB |
| Type safety | Excellent (codegen) | Excellent (inference) |
| Raw SQL ergonomics | Awkward (`$queryRaw`) | First-class (`sql\`...\``) |
| Batch insert returning rows | Not supported | Native |
| Migration tooling maturity | Mature | Improving (drizzle-kit) |
| Team familiarity | Existing | Need to learn |
| Refactor cost | 0 | ~2 weeks dev time |
| Ecosystem (NestJS examples) | Many | Fewer but growing |

**Recommendation:**
- **If perf is the only concern:** Do Phase 0 only. You'll get most of the gain.
- **If you want long-term ergonomics + raw SQL access + smaller deploys:** Do full migration. The 2-week investment pays back in ongoing dev velocity and infra cost.
- **If you're not sure:** Do Phase 0 + Phase 1 (POC on `vans`). Measure. Then decide.

---

## 13. Acceptance criteria

After Phase 0:
- Stock-adjustment create p95 < 500ms (currently timing out at 5s)
- Sale finalize p95 < 800ms
- Distribution create p95 < 800ms
- Dashboard endpoints p95 < 1s
- No 5s transaction timeouts in error log for 7 days

After full Drizzle migration:
- All Prisma imports removed from `src/`
- `package.json` has no `@prisma/client` or `prisma`
- Drizzle migrations folder is the single source of schema truth
- All hot endpoints maintain or improve p95 latency
- API contract (response shape) unchanged — verified by diff against pre-migration captures

---

## 14. Appendix — Files to touch (full list)

### New files
- `src/db/drizzle.service.ts`
- `src/db/drizzle.module.ts`
- `src/db/schema/*.ts` (17 table files + `enums.ts` + `index.ts`)
- `src/db/types.ts`
- `drizzle.config.ts` (root)
- `drizzle/migrations/` (generated)

### Files modified
- `src/app.module.ts` — register `DrizzleModule` alongside `PrismaModule` (later remove Prisma)
- `src/prisma/prisma.service.ts` — Phase 0: add query logging, pool tuning
- `src/common/services/stock-lot.service.ts` — Phase 0: batch updates + parallel; Phase 4: rewrite with Drizzle
- `src/common/services/prefix-id.service.ts` — Drizzle rewrite
- `src/common/filters/all-exceptions.filter.ts` — replace Prisma error matching with `pg` errors
- All 14 service files in `src/modules/*/`*.service.ts
- All 10 DTO files importing from `@prisma/client`
- `src/common/decorators/roles.decorator.ts`, `src/modules/auth/guards/roles.guard.ts`

### Files deleted (after cutover)
- `src/prisma/` (entire folder)
- `prisma/schema.prisma`
- `node_modules/@prisma`, `node_modules/.prisma`

---

**End of LLD.**
