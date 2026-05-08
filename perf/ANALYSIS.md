# GHM-Server Performance Analysis

Run: 2026-04-27, 20 iter/endpoint, 2 warmup, against `localhost:6397` (dev) hitting **Neon Postgres in `us-east-1` (pooler)**.

## TL;DR

Tomar **server code is mostly fine**. The slowness is structural — three compounding problems:

1. **Geographic latency**: app→DB round-trip = ~250–300 ms because Neon is in `us-east-1` and you’re hitting it from Bangladesh / a server far from us-east-1. Every Prisma query pays this once.
2. **Hidden auth tax**: `JwtStrategy.validate()` runs `prisma.user.findFirst()` on **every authenticated request**. So every endpoint pays ≥1 extra DB round-trip *before it even starts*.
3. **Missing pooler config**: `DATABASE_URL` is the Neon `*-pooler` host (pgbouncer) but lacks `pgbouncer=true&connection_limit=1`. With Prisma this is required, otherwise prepared-statement re-prep / connection churn adds latency.

Fix #1 (region) gives the biggest absolute win (~5–6×). Fix #2 (drop DB lookup in JwtStrategy) is a 5-line change with massive return — every authed endpoint gets ~300 ms faster. Fix #3 is a one-line `.env` change.

---

## What the numbers prove

`health.live` does **no DB work** — it returned **2 ms p50** consistently.
`health.ready` does **one `SELECT 1`** — it returned **313 ms p50, 1140 ms p95**.

That delta (≈310 ms) is the per-query overhead. It shows up on every endpoint:

| Endpoint                  | p50      | p95      | DB queries (estimate)        | RTT-implied minimum |
|---                        |---:      |---:      |---                           |---:                 |
| `health.live`             | 2 ms     | 4 ms     | 0                            | 0                   |
| `health.ready`            | 313 ms   | 1140 ms  | 1                            | ~300 ms             |
| `auth.me`                 | 728 ms   | 1733 ms  | 2 (jwt-validate + me-fetch)  | ~600 ms             |
| `products.byId`           | 971 ms   | 1403 ms  | 2 (jwt-validate + findFirst) | ~600 ms             |
| `products.list.default`   | 1976 ms  | 2312 ms  | 4–5 (jwt + tx[findMany,count] + audit) | ~1200 ms |
| `products.history`        | 2069 ms  | 17764 ms | 6 (jwt + 5 parallel)         | ~600 ms (worst-query bound) |
| `categories.dailyStats`   | 1273 ms  | 5234 ms  | unknown (looks aggregate-heavy) | — |

The “2-query” endpoints all clock around 600–1000 ms. The “4–5 query” endpoints clock around 2000 ms. **That maps almost linearly to # of round-trips × 250–300 ms.** Tumi optimization kichu na korleo, this is the ceiling.

---

## Findings & fixes (ordered by impact / effort)

### 🔴 1. Drop the DB lookup in `JwtStrategy.validate`  *(biggest win, smallest change)*

**Problem** — every authenticated request runs:

```ts
// src/modules/auth/strategies/jwt.strategy.ts:25
const user = await this.prisma.user.findFirst({
  where: { id: payload.sub, deletedAt: null, isActive: true },
});
```

JWT is HS256-signed; the payload already has `sub`, `email`, `role`. You don’t need to hit the DB on every request to “verify the user still exists” — that’s what token expiry is for. If you genuinely need revocation, use a small Redis blacklist or short token TTL (e.g. 15 min).

**Fix** —

```ts
// jwt.strategy.ts
async validate(payload: JwtPayload): Promise<AuthUser> {
  return { id: payload.sub, email: payload.email, role: payload.role };
}
```

**Expected impact** — every authed endpoint drops ~300 ms p50. `auth.me` goes from 728 → ~400 ms. `products.byId` from 971 → ~600 ms.

If you must keep a soft check, cache user existence in-memory (LRU, 60s TTL) — same effect, only the first hit per minute pays.

---

### 🔴 2. Fix the Neon pooler URL  *(one-line change)*

**Current** —
```
DATABASE_URL="postgresql://...@ep-...-pooler.../neondb?sslmode=require&channel_binding=require"
```

**Required for Prisma + Neon pooler** —
```
DATABASE_URL="postgresql://...@ep-...-pooler.../neondb?sslmode=require&pgbouncer=true&connection_limit=1"
```

Why: pgbouncer in transaction-pool mode rotates physical connections per transaction. Without `pgbouncer=true`, Prisma uses session-level prepared statements that get re-prepared (or error) on every transaction → wasted round-trips.

For migrations, keep a separate `DIRECT_URL` (Neon’s non-pooler endpoint) wired into `prisma/schema.prisma`’s `directUrl`.

---

### 🔴 3. Region mismatch  *(architectural — biggest absolute win)*

**Problem** — BD → `us-east-1` is fundamentally ~250–300 ms RTT each way. No code optimization can fix this.

Options, ranked:

| Option | Effort | Latency impact |
|---|---|---|
| Move Neon project to `ap-southeast-1` (Singapore) | 30 min — re-deploy DB, update URL | RTT drops to ~50 ms ⇒ 5–6× faster on EVERY endpoint |
| Deploy app server to `us-east-1` (Vercel / Fly / Railway) and let frontend call it | 1–2 hr | App↔DB RTT drops to <5 ms; frontend pays only one BD↔US round-trip per page |
| Stay where you are, add Redis cache (Upstash, edge) for hot reads | 1 day | Helps dashboard / list endpoints; doesn’t fix per-request auth lookup |

For a Bangladesh-targeted business, Singapore is the obvious DB region. Neon supports it.

---

### 🟡 4. `products.findAll` uses an unnecessary `$transaction` for two reads

**Problem** — `src/modules/products/products.service.ts:45`:

```ts
const [items, total] = await this.prisma.$transaction([
  this.prisma.product.findMany(...),
  this.prisma.product.count(...),
]);
```

`$transaction([...])` opens a real transaction (BEGIN…COMMIT) — that’s **2 extra round-trips** on top of the two queries. For two read-only queries that don’t need atomicity, parallelize:

```ts
const [items, total] = await Promise.all([
  this.prisma.product.findMany(...),
  this.prisma.product.count(...),
]);
```

Same applies anywhere else you do `$transaction([read, read])`. Search for that pattern.

**Expected impact** — list endpoints drop ~500 ms p50.

---

### 🟡 5. Missing indexes on `SaleItem.productId` and `InvoiceItem.productId`

**Problem** — `products.history` runs (among others):

```ts
this.prisma.saleItem.findMany({ where: { productId: id }, ... })
```

But `SaleItem` has no index on `productId` — only `id` PK. Same for `InvoiceItem`. Today with seed data this is cheap; at scale it becomes a sequential scan and explains the **17-second p95** outlier.

**Fix** — add to `prisma/schema.prisma`:

```prisma
model SaleItem {
  // ...
  @@index([productId])
  @@index([saleId])     // also useful when joining items back to sale
}

model InvoiceItem {
  // ...
  @@index([productId])
  @@index([invoiceId])
}
```

Then run your usual migration flow (you handle migrations).

---

### 🟡 6. Cache dashboard endpoints

The dashboard hits `/dashboard/metrics`, `/series`, `/vans/performance`, `/categories/breakdown`, `/alerts/low-stock`, `/activity` — that’s 6 calls × ~5 queries each = 30 round-trips on every page load. No cache.

A dashboard does not need to-the-second freshness for a small van-distribution biz.

**Fix** — add a 30–60 second in-memory or Redis cache. Cheapest version: `cache-manager` with `ttl: 30` on the dashboard service methods. `dhakaTodayDateOnly()` is the natural cache key suffix so the cache resets at the day boundary.

---

### 🟢 7. Reduce per-request work

Smaller wins, but easy:

- `health.root` and `health.ready` are slow because Terminus runs `SELECT 1`. Don’t poll these from the frontend — they’re for k8s/load-balancer probes only.
- Audit-log writes in `products.update` etc. happen inside the same transaction as the data write. Fine for correctness, but they cost a round-trip. Consider writing the audit log as an `await tx.auditLog.create(...)` at the *end* of the same transaction (already done) and ensuring the transaction itself uses interactive mode (`prisma.$transaction(async tx => {...})`) which Prisma already pipelines. So this is OK — flagging only because it’s the next thing to look at.
- Frontend: enable HTTP/2 keep-alive and request batching where possible. Multiple parallel calls > waterfall.

---

## Suggested order of operations

1. **Today (10 min total)**:
   - Edit `jwt.strategy.ts` to drop the DB lookup. Re-deploy.
   - Update `DATABASE_URL` with `pgbouncer=true&connection_limit=1`.
   - Re-run `perf/api-perf.spec.ts` and check the diff.

2. **This week**:
   - Migrate Neon project to `ap-southeast-1`.
   - Add `@@index` to `SaleItem` / `InvoiceItem` (you run the migration).
   - Replace `$transaction([read,read])` patterns with `Promise.all`.

3. **Next sprint**:
   - Add Redis cache for dashboard endpoints.
   - Add `X-Request-Id` + per-request DB-query-count header (debug builds) so you can spot N+1 queries early.

---

## How to re-run the benchmark

```bash
# server must be running on :6397 with seeded DB (admin@ghm.local / admin1234)
BASE_URL=http://localhost:6397/api/v1/ \
  ITER=20 WARMUP=2 \
  npx playwright test perf/api-perf.spec.ts -c perf/playwright.config.ts
```

Outputs:
- `perf/report.json` — raw timings
- `perf/REPORT.md`  — human table sorted by p95

Tune `ITER` for stability (30+ for tighter intervals), `SLOW_P95_MS` for the warning threshold.
