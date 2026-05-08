# GHM Server — Context Reference

Quick-load context for Claude. Read this first before exploring the codebase.

## Stack
- NestJS 10 + Prisma 5 + PostgreSQL
- TypeScript (strict)
- Auth: JWT Bearer (passport-jwt); guards applied globally
- Validation: `class-validator` + `class-transformer`, global `ValidationPipe` with `whitelist + forbidNonWhitelisted + transform`
- API prefix: `/api`, URI versioning `/v1`
- Timezone: Asia/Dhaka for all business dates (util: `src/common/util/dhaka-time.ts`)
- Money: integers in BDT (no decimals anywhere)

## Scripts
- `npm start` / `npm run start:dev`
- `npx prisma migrate dev --name <x>` — user usually runs migrations themselves
- `npx prisma generate` — after schema edits
- `npx tsc --noEmit -p tsconfig.build.json` — typecheck

## Domain
Van-distribution business in Bangladesh (perishable goods). Warehouse → Vans (Distribution) → Sales (from van) → Invoice.

## Prisma Models (schema: `prisma/schema.prisma`)

| Model | Purpose | Key fields |
|---|---|---|
| `User` | auth | email, passwordHash, role (ADMIN/MANAGER/STAFF) |
| `Category` | product category | name (unique) |
| `Product` | catalog + running stock | id `PRD-XXX`, categoryId, unit, buyPrice, sellPrice, stock |
| `Van` | delivery van | id `V1/V2/...`, vanName, driver |
| `StockEntry` | purchase / stock-in | id `STK-XXX`, productId, quantity, buyingRate, source. **Increments** `Product.stock` |
| `StockAdjustment` | damage / wastage / correction | id `ADJ-XXX`, reason (DAMAGE/WASTAGE/CORRECTION), location (WAREHOUSE/VAN), vanId?. **Decrements** `Product.stock` when WAREHOUSE |
| `Distribution` + `DistributionLine` | warehouse → van | `@@unique([vanId, date])`, line has `allocated` + `returned` |
| `Sale` + `SaleItem` | sale from van; finalizes a cycle | creates paired `Invoice` |
| `Invoice` + `InvoiceItem` | billing | status `unpaid`/`paid`, paid is one-way |
| `Expense` | operating cost | category (string enum-style), vanId? |
| `Transaction` | activity feed | type `sale`/`expense`/`stock` |
| `AuditLog` | audit | before/after JSON |
| `IdSequence` | prefix-id generator | used by `PrefixIdService.next(prefix, width, tx)` |

### Enums
- `ProductUnit`: kg, piece, pcs, sack, crate, litre, bundle
- `EntityStatus`: Active, Inactive
- `InvoiceStatus`: unpaid, paid
- `ExpenseStatus`: paid, pending
- `UserRole`: ADMIN, MANAGER, STAFF
- `TransactionType`: sale, expense, stock
- `StockAdjustmentReason`: DAMAGE, WASTAGE, CORRECTION
- `StockLocation`: WAREHOUSE, VAN

## Stock Movement Model (as implemented)

```
Opening
  + StockEntry.quantity            (Product.stock +=)
  − Distribution.allocated         (Product.stock -=)
  + DistributionLine.returned      (on close of day, added back)
  − SaleItem.qty                   (consumed from van allocation)
  − StockAdjustment                (Product.stock -= when location=WAREHOUSE)
= Closing
```

Opening/Closing are derived, not stored. Reserved/Transfer are not modeled (not needed).

## Module Layout (`src/modules/<name>/`)

Standard file set per module:
- `<name>.module.ts`
- `<name>.controller.ts` — `@Controller({ path, version: '1' })`
- `<name>.service.ts`
- `dto/` — `create-*.dto.ts`, `update-*.dto.ts`, `list-*.query.ts`

Modules registered in `src/app.module.ts`:
auth, categories, products, stock-entries, stock-adjustments, vans, distributions, sales, invoices, expenses, dashboard, accounting, reports, search + health.

## Conventions

- **IDs**: use `PrefixIdService.next('PRE', 3, tx)` inside `prisma.$transaction`. Known prefixes: PRD, STK, ADJ, DST, SAL, INV, EXP, V. Stored in `IdSequence` table.
- **Dates**: `@db.Date` columns — always go through `parseDhakaDateOnly(yyyy-mm-dd)` in services.
- **List queries**: extend `PaginationQueryDto` (page/pageSize/sort/q). Response via `listResponse(items, total, q)`.
- **Errors**: `BadRequestException({ code, message, fields })` / `NotFoundException({ code, message })`.
- **Soft delete**: `deletedAt: null` filter on all reads; set `deletedAt: new Date()` on delete.
- **Activity feed**: write a `Transaction` row whenever a stock-affecting or money-moving operation happens.
- **Controller**: always `@ApiTags`, `@ApiBearerAuth`, `@ApiOperation` for Swagger.
- **Validation**: class-validator decorators on every DTO field. Use `@ValidateIf` for conditional-required fields.

## Common Utils
- `src/common/util/dhaka-time.ts` — `parseDhakaDateOnly`, `dhakaDayBoundsUtc`, `dhakaRangeUtc`, `monthBoundsUtc`, `dhakaTodayDateOnly`
- `src/common/services/prefix-id.service.ts` — prefix-id generator
- `src/common/dto/pagination.dto.ts` — `PaginationQueryDto`, `listResponse`

## Endpoints Base
`/api/v1/<module>` — see controllers for exact routes. Public: `POST /auth/login`, `GET /health*`. All else JWT-guarded.

## When adding a new module (checklist)
1. Add model(s) to `prisma/schema.prisma`, add reverse relations on related models.
2. `npx prisma migrate dev --name <name>` + `npx prisma generate`.
3. Copy `stock-entries` module as a template.
4. Register in `src/app.module.ts` imports array.
5. `npx tsc --noEmit -p tsconfig.build.json` to typecheck.

## Things the user has said
- Prefers concise answers; frequently writes Banglish (Bangla in Latin script) mixed with English.
- Usually runs Prisma migrations themselves — don't run `prisma migrate dev` unless asked.
- Wants this file kept up-to-date so future sessions consume fewer tokens.
