# GHM Server — Frontend API Reference

NestJS + Prisma + PostgreSQL (Neon) backend for the GHM dashboard.

- **Base URL (dev):** `http://localhost:6000/api/v1`
- **Swagger UI:** `http://localhost:6000/docs`
- **Auth:** Bearer JWT in `Authorization` header (everything except `POST /auth/login` and `/health/*`)

---

## Quick start

```bash
npm install
npx prisma migrate dev --name init   # or: npx prisma db push
npm run prisma:seed
npm run start:dev
```

Seeded login: `admin@ghm.local / admin1234` (also `manager@…` and `staff@…`).

---

## Conventions

### Money
All monetary fields are **integers in BDT (৳)** — no decimals.

### Units
Stock fields always include a `unit`: `"kg" | "piece" | "sack" | "crate"`.

### Dates
- Dates in lists / inputs: `YYYY-MM-DD`
- Timestamps in audit / activity feeds: ISO 8601 UTC
- Server treats "today" using **Asia/Dhaka** calendar.

### IDs
Human-readable prefixed IDs are canonical and returned as `id`:
`PRD-001`, `STK-001`, `DST-001`, `SAL-001`, `INV-1001`, `EXP-001`, `V1`.

### Response shapes

**Single resource** — returned directly:
```json
{ "id": "PRD-001", "name": "Premium Tomato", ... }
```

**List**:
```json
{ "data": [...], "page": 1, "pageSize": 20, "total": 143 }
```

**Error**:
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "...",
    "fields": { "sellPrice": ["required"] },
    "requestId": "..."
  }
}
```

Domain-specific error codes:
- `INSUFFICIENT_STOCK` (409) — body includes `productIds: string[]`
- `INVOICE_LOCKED` (400) — paid invoices cannot revert status
- `INVALID_CREDENTIALS` (401)
- `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404)
- `UNIQUE_CONSTRAINT_VIOLATION` (409)

### List query params

`?page=1&pageSize=20&sort=-date&q=tomato` — `-` prefix on `sort` means DESC.
Multi-field sort: `sort=-date,name`.

---

## Auth

### `POST /auth/login`
```json
// request
{ "email": "admin@ghm.local", "password": "admin1234" }

// response 200
{
  "token": "eyJhbGciOi...",
  "user": { "id": "uuid", "email": "...", "name": "Admin", "role": "ADMIN" }
}
```

### `GET /auth/me`
Returns the authenticated user.
```json
{ "id": "uuid", "email": "...", "name": "Admin", "role": "ADMIN", "isActive": true, "createdAt": "..." }
```

---

## Products

### `GET /products`
Query: `?page&pageSize&sort&q&category`
`category`: `Vegetable | Spice | Fruit | Root | Leafy`

```json
{
  "data": [
    {
      "id": "PRD-001",
      "name": "Premium Tomato",
      "category": "Vegetable",
      "unit": "kg",
      "buyPrice": 40,
      "sellPrice": 60,
      "stock": 200,
      "status": "Active",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "page": 1, "pageSize": 20, "total": 5
}
```

### `POST /products`
```json
{
  "name": "Premium Tomato",
  "category": "Vegetable",
  "unit": "kg",
  "buyPrice": 40,
  "sellPrice": 60,
  "stock": 0,            // optional, default 0
  "status": "Active"      // optional
}
```

### `PUT /products/:id` — full replace (same body as POST).
### `PATCH /products/:id` — partial update; e.g. `{ "status": "Inactive" }`
### `DELETE /products/:id` — soft delete; returns `204`.
### `GET /products/:id/history`
```json
{
  "stockEntries": [...],
  "distributionLines": [...],
  "saleItems": [...],
  "audit": [...]
}
```

---

## Stock entries

### `GET /stock-entries`
Query: `?page&pageSize&sort&q&productId&dateFrom&dateTo`

### `POST /stock-entries`
```json
{
  "date": "2026-04-18",
  "productId": "PRD-001",
  "quantity": 100,
  "buyingRate": 38,
  "source": "Gazipur Central Market",
  "notes": "morning lot"
}
```
**Side effect:** product `stock += quantity`. Logs an activity transaction.

### `GET /stock-entries/:id`

---

## Vans

### `GET /vans`
```json
[
  { "vanId": "V1", "vanName": "Van 1 - North", "driver": "Rahim",
    "sales": 2400, "distributed": 70, "returned": 7 }
]
```

### `GET /vans/:id` — same shape, single object.

### `POST /vans`
```json
{ "id": "V4", "vanName": "Van 4 - West", "driver": "Habib" }
```

### `GET /vans/:id/distribution?date=YYYY-MM-DD`
Defaults to today (Dhaka). Returns the van's allocation for that day:
```json
{
  "id": "DST-001",
  "vanId": "V1",
  "date": "2026-04-18",
  "lines": [
    { "id": "...", "productId": "PRD-001", "allocated": 40, "returned": 5,
      "product": { "name": "Premium Tomato", "unit": "kg" } }
  ]
}
```
If no allocation exists yet, `id` is `null` and `lines` is `[]`.

---

## Distributions

### `POST /distributions`
```json
{
  "vanId": "V1",
  "date": "2026-04-18",
  "lines": [
    { "productId": "PRD-001", "allocated": 40 },
    { "productId": "PRD-002", "allocated": 30 }
  ]
}
```
Atomically decrements product stock. Returns the created distribution with lines.
Returns `409 INSUFFICIENT_STOCK` with `productIds` if any product would go negative.

### `PATCH /distributions/:id/lines/:lineId`
```json
{ "allocated": 50 }   // or { "returned": 5 } or both
```
Adjusts product stock by the delta. Returns the updated line.

### `DELETE /distributions/:id/lines/:lineId`
Refunds remaining (`allocated - returned`) back to product stock. Returns `204`.

---

## Sales

### `POST /sales`
"Finalize cycle" — creates both a `Sale` and an `Invoice`, decrements stock, records revenue.
```json
{
  "vanId": "V1",
  "date": "2026-04-18",
  "items": [
    { "productId": "PRD-001", "price": 60, "qty": 30 },
    { "productId": "PRD-002", "price": 75, "qty": 8 }
  ]
}
```
Returns the created invoice (list-shape):
```json
{
  "id": "INV-1003",
  "date": "2026-04-18",
  "van": "Van 1 - North",
  "vanId": "V1",
  "items": 2,
  "total": 2400,
  "status": "unpaid"
}
```
`409 INSUFFICIENT_STOCK` on overdraw.

### `GET /sales/last?vanId=V1`
The most recent sale + its invoice + line items for that van. Powers the **Print Last** button.

---

## Invoices

### `GET /invoices`
Query: `?page&pageSize&sort&q&status`
`status`: `paid | unpaid | all` (default `all`)

```json
{
  "data": [
    { "id": "INV-1001", "date": "2026-04-18", "van": "Van 1 - North",
      "vanId": "V1", "items": 2, "total": 2400, "status": "paid" }
  ],
  "page": 1, "pageSize": 20, "total": 2
}
```

### `GET /invoices/:id`
Full detail with line items:
```json
{
  "id": "INV-1001",
  "date": "2026-04-18",
  "vanId": "V1",
  "van": { "id": "V1", "vanName": "Van 1 - North", "driver": "Rahim", ... },
  "total": 2400,
  "status": "paid",
  "paidAt": "...",
  "items": [
    { "id": "...", "productId": "PRD-001", "name": "Premium Tomato",
      "price": 60, "qty": 30, "subtotal": 1800 }
  ]
}
```

### `PATCH /invoices/:id`
```json
{ "status": "paid" }
```
**Immutable rule:** once `paid`, status cannot revert → `400 INVOICE_LOCKED`.

### `GET /invoices/:id/pdf`
Returns `application/pdf` (binary download).

### `GET /invoices/export?status=&q=`
Returns `text/csv` of invoices. Same filters as the list endpoint.

---

## Expenses

### `GET /expenses`
Query: `?page&pageSize&sort&q&category&status&dateFrom&dateTo`
- `category`: `"Fuel" | "Van Rent" | "Labor Cost" | "Shipping Cost" | "Market Fees"`
- `status`: `"paid" | "pending"`

```json
{
  "data": [
    { "id": "EXP-001", "date": "2026-04-18", "category": "Fuel",
      "amount": 1200, "description": "Diesel for V1", "status": "paid",
      "vanId": "V1", "createdAt": "...", "updatedAt": "..." }
  ],
  "page": 1, "pageSize": 20, "total": 2
}
```

### `POST /expenses`
```json
{
  "date": "2026-04-18",
  "category": "Fuel",
  "amount": 1200,
  "description": "Diesel for V1",
  "status": "paid",       // optional, default "pending"
  "vanId": "V1"           // optional
}
```

### `PATCH /expenses/:id` — partial update.
### `DELETE /expenses/:id` — soft delete; returns `204`.
### `GET /expenses/export?…` — CSV download.

---

## Dashboard

All endpoints use **Asia/Dhaka** for "today" / period boundaries.

### `GET /dashboard/metrics`
```json
{
  "todayRevenue": 3480,
  "todayExpenses": 1550,
  "todayProfit": 1930,
  "todayInvoices": 2,
  "stockOnHand": 413,
  "lowStockCount": 2
}
```

### `GET /dashboard/series?timeframe=daily|weekly|monthly|yearly`
Default: `weekly`. Bucket label format depends on timeframe (`HH:00`, `EEE`, `dd`, `MMM`).
```json
[
  { "label": "Mon", "revenue": 12000, "cost": 7000, "profit": 4500, "stock": 320 }
]
```

### `GET /dashboard/vans/performance`
```json
[
  { "van": "Van 1 - North", "revenue": 12400, "efficiency": 87, "returned": 12 }
]
```
`efficiency` is `(allocated - returned) / allocated * 100` (integer percent).

### `GET /dashboard/categories/breakdown`
```json
[ { "name": "Vegetable", "value": 65 }, { "name": "Root", "value": 20 } ]
```
`value` is percent of revenue (0–100, integer).

### `GET /dashboard/alerts/low-stock?threshold=10`
```json
[ { "productId": "PRD-005", "name": "Banana", "stock": 8, "unit": "crate", "category": "Fruit" } ]
```

### `GET /dashboard/activity?limit=10`
```json
[
  { "id": "...", "date": "2026-04-18T09:41:00Z", "amount": 2400,
    "type": "sale", "description": "Sale on V1 (2 items)" }
]
```
`type`: `"sale" | "expense" | "stock"`. Expense amounts are negative.

---

## Accounting

### `GET /accounting/ledger?month=YYYY-MM`
Defaults to current Dhaka month.
```json
{
  "month": "2026-04",
  "revenue": 124800,
  "cost": 71200,
  "expenses": 9400,
  "grossProfit": 53600,
  "netProfit": 44200,
  "stockUnits": 1520
}
```

### `GET /accounting/van-profitability?month=YYYY-MM`
```json
[
  { "vanId": "V1", "vanName": "Van 1 - North",
    "revenue": 42000, "expenses": 3500, "netProfit": 38500 }
]
```

---

## Reports

### `GET /reports/:type?dateFrom=&dateTo=&format=`
- `type`: `"sales" | "expenses" | "stock" | "profit-by-van"`
- `format=csv` returns `text/csv`; otherwise JSON array.

Examples:
```
GET /reports/sales?dateFrom=2026-04-01&dateTo=2026-04-30
GET /reports/expenses?format=csv
```

---

## Search

### `GET /search`
```
?q=tomato
&kind=all|sales|stock|expenses|returns        (default all)
&dateRange=7d|30d|90d|ytd
&vanId=V1
&category=Vegetable
&status=completed|stored|processed|pending
&page=&pageSize=
```

```json
{
  "data": [
    { "id": "INV-1001", "type": "sales", "title": "Invoice INV-1001",
      "amount": 2400, "date": "2026-04-18", "van": "Van 1 - North",
      "status": "completed", "category": "Sales" }
  ],
  "page": 1, "pageSize": 20, "total": 18
}
```

---

## Health

### `GET /health` — overall (memory + DB)
### `GET /health/liveness` — process is up
### `GET /health/readiness` — DB reachable

```json
{ "status": "ok", "info": { "memory_heap": { "status": "up" }, "database": { "status": "up" } }, "details": {...} }
```

---

## Headers

- **Request:** `Authorization: Bearer <token>` (required), `X-Request-Id` (optional — server echoes/generates one)
- **Response:** `X-Request-Id` (always), `Content-Disposition` (on PDF/CSV downloads)

---

## Rate limiting

Defaults: `100 req / 60s` per IP (`429 TOO_MANY_REQUESTS`). Tunable via `THROTTLE_TTL` / `THROTTLE_LIMIT` env vars.

---

## Common gotchas

- **401 on every request?** Add the `Authorization: Bearer <token>` header.
- **Stock didn't decrement?** Make sure you called `POST /sales` (which finalizes) or `POST /distributions` — both are atomic, both can return `409 INSUFFICIENT_STOCK`.
- **Paid invoice won't update?** That's by design; only status flips *to* `paid` are allowed once paid.
- **Date filtering off by a day?** Send `YYYY-MM-DD` (Dhaka calendar). The server handles timezone conversion.
# ghm-backend
