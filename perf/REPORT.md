# GHM-Server API Perf Report

- Run at: 2026-04-27T11:04:25.582Z
- Iterations per endpoint: 20 (warmup 2)
- Slow threshold (p95 > 500ms) flagged with **SLOW**

## Endpoints sorted by p95 (slowest first)

| # | Endpoint | Method | p50 | p95 | p99 | max | avg | n | errs | status | bytes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `products.history` **SLOW** | GET `/products/PRD-001/history` | 2069 | 17764 | 17764 | 17764 | 3195 | 20 | 1 | 200 | 1809 |
| 2 | `categories.dailyStats` **SLOW** | GET `/categories/stats/daily` | 1273 | 5234 | 5234 | 5234 | 1594 | 20 | 0 | 200 | 388 |
| 3 | `stockEntries.list` **SLOW** | GET `/stock-entries?page=1&pageSize=20` | 2106 | 2783 | 2783 | 2783 | 2201 | 20 | 0 | 200 | 1025 |
| 4 | `products.list.byCategory` **SLOW** | GET `/products?categoryId=CAT-01` | 1933 | 2563 | 2563 | 2563 | 1975 | 20 | 0 | 200 | 448 |
| 5 | `stockAdj.list` **SLOW** | GET `/stock-adjustments?page=1&pageSize=20` | 1905 | 2538 | 2538 | 2538 | 1990 | 20 | 0 | 200 | 3997 |
| 6 | `products.list.activeOnly` **SLOW** | GET `/products?status=Active` | 1918 | 2425 | 2425 | 2425 | 1957 | 20 | 0 | 200 | 1225 |
| 7 | `products.list.search` **SLOW** | GET `/products?q=tomato` | 1945 | 2348 | 2348 | 2348 | 2001 | 20 | 0 | 200 | 448 |
| 8 | `products.list.default` **SLOW** | GET `/products?page=1&pageSize=20` | 1976 | 2312 | 2312 | 2312 | 1959 | 20 | 0 | 200 | 1630 |
| 9 | `categories.list` **SLOW** | GET `/categories` | 719 | 2153 | 2153 | 2153 | 888 | 20 | 0 | 200 | 970 |
| 10 | `products.list.large` **SLOW** | GET `/products?page=1&pageSize=200` | 1911 | 2141 | 2141 | 2141 | 1935 | 20 | 0 | 200 | 1631 |
| 11 | `stockEntries.byProduct` **SLOW** | GET `/stock-entries?productId=PRD-001` | 1603 | 1991 | 1991 | 1991 | 1656 | 20 | 0 | 200 | 44 |
| 12 | `auth.me` **SLOW** | GET `/auth/me` | 728 | 1733 | 1733 | 1733 | 909 | 20 | 0 | 200 | 156 |
| 13 | `products.byId` **SLOW** | GET `/products/PRD-001` | 971 | 1403 | 1403 | 1403 | 1000 | 20 | 0 | 200 | 404 |
| 14 | `categories.byId` **SLOW** | GET `/categories/CAT-01` | 1023 | 1348 | 1348 | 1348 | 1046 | 20 | 0 | 200 | 406 |
| 15 | `health.ready` **SLOW** | GET `/health/readiness` | 313 | 1140 | 1140 | 1140 | 413 | 20 | 0 | 200 | 101 |
| 16 | `stockEntries.byId` **SLOW** | GET `/stock-entries/STK-001` | 650 | 993 | 993 | 993 | 665 | 20 | 20 | 404 | 123 |
| 17 | `health.root` **SLOW** | GET `/health` | 304 | 889 | 889 | 889 | 407 | 20 | 0 | 200 | 161 |
| 18 | `health.live` | GET `/health/liveness` | 2 | 4 | 4 | 4 | 2 | 20 | 0 | 200 | 49 |