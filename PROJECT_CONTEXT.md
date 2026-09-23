# GHM Server — Context Reference

Quick-load context for Claude. Read this first before exploring the codebase.

## Stack
- NestJS 10 + Prisma 5 + PostgreSQL
- TypeScript (strict)
- Auth: JWT Bearer (passport-jwt); guards applied globally
- Validation: `class-validator` + `class-transformer`, global `ValidationPipe` with `whitelist + forbidNonWhitelisted + transform`
- API prefix: `/api`, URI versioning `/v1` (default version applies even to controllers with no explicit `version`, e.g. health → `/api/v1/health`)
- Timezone: Asia/Dhaka for all business dates (util: `src/common/util/dhaka-time.ts`)
- Money: integers in BDT (no decimals anywhere)

## Scripts
- `npm start` / `npm run start:dev`
- `npx prisma migrate dev --name <x>` — user runs migrations themselves
- `npx prisma generate` — after schema edits
- `npx tsc --noEmit -p tsconfig.build.json` — typecheck (delete `dist/tsconfig.build.tsbuildinfo` first if output looks truncated/inconsistent — the incremental cache can produce flaky partial results)

## Domain
Van-distribution business in Bangladesh (perishable goods). Purchases → Warehouse (FIFO lots) → Vans (Distribution) or direct customer sale → Invoice. Also supports a restaurant/shop issue→confirm flow (DistributionOrder) and basic bank-account tracking.

## Pricing ladder (as of 2026-07-14 migration `add_pricing_ladder`)
`Product` and `StockEntry` use a 4-tier pricing model, **not** a simple buy/sell pair:
- `basePrice` — landed unit cost (was `buyPrice`/`buyingRate`)
- `listPrice` — base + tax/profit/other % (informational)
- `tradePrice` — the price actually charged (was `sellPrice`)
- `mrp` — list + tax/profit/other % (informational/compliance only)

Each also carries nullable `*TaxPercent`/`*ProfitPercent`/`*OthersPercent` "recipe" fields (prefill only, not authoritative). `StockEntry`'s `listPrice`/`tradePrice`/`mrp` are per-lot overrides — null falls back to the `Product`'s value. When grepping/writing code, **check `prisma/schema.prisma` field names directly** rather than trusting old references to `buyPrice`/`buyingRate`/`sellPrice` — those were renamed and this doc (and old comments in the code) may lag behind a rename like this again.

## Prisma Models (schema: `prisma/schema.prisma`)

| Model | Purpose | Key fields |
|---|---|---|
| `User` | auth | email, passwordHash, role (ADMIN/MANAGER/STAFF) |
| `Category` | product category | name (unique) |
| `Product` | catalog + running warehouse stock | id `PRD-XXX`, categoryId, unit, basePrice/listPrice/tradePrice/mrp, stock |
| `Van` | delivery van | id `V1/V2/...`, vanName, driver |
| `Customer` | restaurant/shop/direct buyer billed outside the van round | id `CUS-XXX`, type (RESTAURANT/SHOP/DIRECT/OTHER) |
| `StockBatch` | a physical receiving group holding 1+ `StockEntry` lines (possibly multi-product) | id `BAT-XXX`; created directly or auto-created by a `Purchase` or van-salvage |
| `StockEntry` | one FIFO cost lot | id `STK-XXX`, productId, batchId?, quantity, **remainingQuantity** (live FIFO balance), basePrice, condition (FRESH/AGING/DAMAGED/CUSTOM) |
| `StockLotAllocation` | **the FIFO consumption ledger** — one row per unit-slice taken from a `StockEntry` | stockEntryId, parentAllocationId? (sub-consumption, e.g. sale from a van-allocated line), consumerType (DISTRIBUTION_LINE/SALE_ITEM/STOCK_ADJUSTMENT), consumerId, quantity, remainingQuantity (only meaningful for DISTRIBUTION_LINE rows — van-side balance), **unitCost** (snapshot of `StockEntry.basePrice` at consumption — the COGS basis) |
| `StockAdjustment` | damage / wastage / correction taken directly from the warehouse | id `ADJ-XXX`, reason, location (WAREHOUSE/VAN), vanId? |
| `Distribution` + `DistributionLine` | warehouse → van | `@@unique` not enforced by day (multi-per-day allowed); line has `allocated`/`returned`/`damageReturned`. Actual lot bookkeeping lives in `StockLotAllocation`, not on the line itself |
| `DistributionOrder` + `DistributionOrderLine` | restaurant/shop **issue → confirm** flow | creating an order does NOT move stock; only `/confirm` allocates FIFO warehouse lots straight to a `SALE_ITEM` (no `DistributionLine` hop) and produces a `Sale`+`Invoice` |
| `Sale` + `SaleItem` | a sale (van / distribution-confirmation / direct-customer); finalizes a cycle | type (VAN/DISTRIBUTION_CONFIRMATION/DIRECT_CUSTOMER); creates a paired `Invoice`. `SaleItem` has `price`/`qty` only — cost is derived via `StockLotAllocation` (consumerType=SALE_ITEM, consumerId=SaleItem.id), never stored on the row itself |
| `Invoice` + `InvoiceItem` | billing | status `unpaid`/`paid`, paid is one-way |
| `Purchase` + `PurchaseLine` | buy-side cost calculation feeding a `StockBatch`/`StockEntry` | line's `effectiveBuyPrice = (basePrice*qty + transport + labour + other) / qty`; only FRESH lines auto-update `Product.basePrice`/`tradePrice` |
| `BankAccount` + `BankTransaction` | basic bank balance tracking | a `Purchase` can optionally deduct from a `bankAccountId` |
| `Expense` | operating cost | category (string enum-style), vanId? |
| `Transaction` | activity feed | type sale/expense/stock/purchase/bank_deposit/bank_withdrawal |
| `AuditLog` | audit | before/after JSON |
| `IdSequence` | prefix-id generator | used by `PrefixIdService.next(prefix, width, tx)` |

### Enums
- `ProductUnit`: kg, piece, pcs, sack, crate, litre, bundle
- `EntityStatus`: Active, Inactive
- `StockCondition`: FRESH, AGING, DAMAGED, CUSTOM — FIFO groups by condition so damaged/fresh of the same product never mix
- `StockLotConsumerType`: DISTRIBUTION_LINE, SALE_ITEM, STOCK_ADJUSTMENT
- `StockAdjustmentReason`: DAMAGE, WASTAGE, CORRECTION
- `StockLocation`: WAREHOUSE, VAN
- `SaleType`: VAN, DISTRIBUTION_CONFIRMATION, DIRECT_CUSTOMER
- `InvoiceStatus`: unpaid, paid
- `ExpenseStatus`: paid, pending
- `DistributionOrderStatus`: issued, confirmed, cancelled
- `PurchaseStatus`: draft, confirmed
- `BankTransactionType`: deposit, withdrawal
- `UserRole`: ADMIN, MANAGER, STAFF
- `TransactionType`: sale, expense, stock, purchase, bank_deposit, bank_withdrawal
- `CustomerType`: RESTAURANT, SHOP, DIRECT, OTHER

## Stock Movement Model — real FIFO lot tracking (not a plain running counter)

This is more sophisticated than "increment/decrement a number." Ground truth lives in `src/common/services/stock-lot.service.ts` (`StockLotService`):

- `Product.stock` is a **derived cache** = Σ `StockEntry.remainingQuantity` (warehouse-only, non-expired, non-deleted), recomputed via `recomputeProductStock()` after every stock-affecting mutation. Units already dispatched to a van are **not** counted here — they live in `StockLotAllocation` rows.
- `StockEntry.remainingQuantity` — per-lot warehouse FIFO balance.
- `allocateFromWarehouse()` — FIFO-consumes warehouse lots (oldest `date` first), returns slices `{stockEntryId, quantity, unitCost}`. Caller creates the `StockLotAllocation` row(s).
- `allocateFromVan()` — FIFO-consumes **van-side** lots (active `DISTRIBUTION_LINE` allocations for that van/product), decrementing the parent allocation's `remainingQuantity`. Crucially, the returned slice's `stockEntryId` is the **original warehouse lot**, not the van allocation row — so a sale made off a van still traces back to its true batch/cost lot.
- `reverseAllocationsFor()` — undoes a consumer's allocations on delete/void (returns quantity to parent or to the source `StockEntry`).
- Van damage (`DistributionLine.damageReturned`) burns the van allocation's `remainingQuantity` **in place, with no new ledger row** — it's not separately queryable after the fact; it can only be recovered as a residual via the conservation invariant `received = remaining + sold + warehouseWriteOff + vanLoss`.

COGS for a sale = Σ `StockLotAllocation.quantity * unitCost` for that sale's `SALE_ITEM` rows. `sales.service.ts` already computes this per-sale (`finalize()`/`direct()`) but only returns it in the response / `AuditLog.meta` — nothing persists it. The `accounting`, `dashboard`, and `reports` modules now join through `stock_lot_allocations → sale_items → sales → invoices` (raw SQL, see `accounting.service.ts`) to get true period/van COGS instead of the old (wrong) "stock purchased in the period" proxy.

## Module Layout (`src/modules/<name>/`)

Standard file set per module:
- `<name>.module.ts`
- `<name>.controller.ts` — `@Controller({ path, version: '1' })`
- `<name>.service.ts`
- `dto/` — `create-*.dto.ts`, `update-*.dto.ts`, `list-*.query.ts`

Modules registered in `src/app.module.ts`:
auth, categories, products, purchases, banking, stock-entries, stock-batches, stock-adjustments, vans, customers, distributions, distribution-orders, sales, invoices, expenses, dashboard, accounting, reports, search + health.

`accounting` also owns **batch-wise profit/loss** (`batch-profitability.service.ts`): `GET /v1/accounting/batches` (paginated, filters `productId`/`dateFrom`/`dateTo`) and `GET /v1/accounting/batches/:batchId` — per-batch (and per-product-within-batch) total cost, sold qty/revenue/COGS, realized profit, remaining unsold qty (warehouse + van, live), warehouse/van loss, and potential profit if the remainder also sells. All computed live from `StockEntry`/`StockLotAllocation`/`SaleItem` — no persisted COGS column, no migration.

## Conventions

- **IDs**: use `PrefixIdService.next('PRE', 3, tx)` inside `prisma.$transaction`. Known prefixes: PRD, STK, BAT, ADJ, DST, DOR, SAL, INV, EXP, PUR, V, CUS. Stored in `IdSequence` table.
- **Dates**: `@db.Date` columns — always go through `parseDhakaDateOnly(yyyy-mm-dd)` in services.
- **List queries**: extend `PaginationQueryDto` (page/pageSize/sort/q). Response via `listResponse(items, total, q)`.
- **Errors**: `BadRequestException({ code, message, fields })` / `NotFoundException({ code, message })`.
- **Soft delete**: `deletedAt: null` filter on all reads; set `deletedAt: new Date()` on delete.
- **Activity feed**: write a `Transaction` row whenever a stock-affecting or money-moving operation happens.
- **Controller**: always `@ApiTags`, `@ApiBearerAuth`, `@ApiOperation` for Swagger.
- **Validation**: class-validator decorators on every DTO field. Use `@ValidateIf` for conditional-required fields.
- **Raw SQL**: table names are snake_case via `@@map` (e.g. `stock_lot_allocations`, `sale_items`), but column names stay camelCase and need double-quoting (e.g. `"unitCost"`). Postgres enum columns need an explicit cast in raw SQL, e.g. `a."consumerType" = 'SALE_ITEM'::"StockLotConsumerType"`.

## Common Utils
- `src/common/util/dhaka-time.ts` — `parseDhakaDateOnly`, `dhakaDayBoundsUtc`, `dhakaRangeUtc`, `monthBoundsUtc`, `dhakaTodayDateOnly`
- `src/common/services/prefix-id.service.ts` — prefix-id generator
- `src/common/services/stock-lot.service.ts` — FIFO lot allocation/reversal/stock-recompute (the heart of the stock model)
- `src/common/dto/pagination.dto.ts` — `PaginationQueryDto`, `listResponse`

## Endpoints Base
`/api/v1/<module>` — see controllers for exact routes. Public: `POST /auth/login`, `GET /health*`. All else JWT-guarded. Swagger at `/docs` (when `SWAGGER_ENABLED=true`), JSON spec at `/docs-json`.

## When adding a new module (checklist)
1. Add model(s) to `prisma/schema.prisma`, add reverse relations on related models.
2. `npx prisma migrate dev --name <name>` + `npx prisma generate`.
3. Copy `stock-entries` (or `accounting`, if it's a reporting/aggregation module) as a template.
4. Register in `src/app.module.ts` imports array.
5. `npx tsc --noEmit -p tsconfig.build.json` to typecheck.

## Things the user has said
- Prefers concise answers; frequently writes Banglish (Bangla in Latin script) mixed with English.
- Usually runs Prisma migrations themselves — don't run `prisma migrate dev` unless asked.
- Wants this file kept up-to-date so future sessions consume fewer tokens.
- Runs a dev server on port 6398 (from `.env` `PORT=6398`) separately from any session's own testing — when verifying changes at runtime, prefer spinning up a temporary instance on another port (e.g. `PORT=6399 node dist/src/main.js`) rather than touching/restarting whatever is already listening on 6398, and kill it when done.
