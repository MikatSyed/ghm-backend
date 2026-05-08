/**
 * GHM-Server API Performance Benchmark
 * --------------------------------------------------------------
 * Drives every HTTP endpoint with realistic Bangladesh van-distribution
 * payloads, measures per-endpoint latency (min / p50 / p95 / p99 / max),
 * and writes:
 *   - perf/report.json   (machine-readable)
 *   - perf/REPORT.md     (human-readable, sorted by p95 desc)
 *
 * Usage:
 *   BASE_URL=http://localhost:6397/api/v1  ITER=30  WARMUP=3 \
 *     npx playwright test perf/api-perf.spec.ts -c perf/playwright.config.ts
 */
import { APIRequestContext, expect, request, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ITER = Number(process.env.ITER ?? 30);
const WARMUP = Number(process.env.WARMUP ?? 3);
const EMAIL = process.env.TEST_EMAIL ?? 'admin@ghm.local';
const PASSWORD = process.env.TEST_PASSWORD ?? 'admin1234';
const SLOW_P95_MS = Number(process.env.SLOW_P95_MS ?? 500);

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface Sample {
  name: string;
  method: Method;
  url: string;
  iter: number;
  errors: number;
  lastStatus: number;
  bytes: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  avg: number;
  serverTimingDb?: number; // optional, if backend exposes it
}

function pct(arr: number[], q: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

async function callOnce(
  ctx: APIRequestContext,
  method: Method,
  url: string,
  body?: unknown,
): Promise<{ ms: number; status: number; size: number }> {
  // Strip leading slash so the URL resolves against the *full* baseURL
  // (e.g. "http://host/api/v1/" + "products" rather than the host root).
  const target = url.startsWith('/') ? url.slice(1) : url;
  const opts: Parameters<APIRequestContext['fetch']>[1] = { method };
  if (body !== undefined) opts.data = body;
  const t0 = performance.now();
  const res = await ctx.fetch(target, opts);
  const buf = await res.body();
  const ms = performance.now() - t0;
  return { ms, status: res.status(), size: buf.length };
}

async function bench(
  ctx: APIRequestContext,
  name: string,
  method: Method,
  url: string,
  body?: unknown,
  iter = ITER,
  warmup = WARMUP,
): Promise<Sample> {
  for (let i = 0; i < warmup; i++) {
    try {
      await callOnce(ctx, method, url, body);
    } catch {
      /* swallow warmup errors */
    }
  }
  const samples: number[] = [];
  let errors = 0;
  let lastStatus = 0;
  let bytes = 0;
  for (let i = 0; i < iter; i++) {
    try {
      const { ms, status, size } = await callOnce(ctx, method, url, body);
      samples.push(ms);
      lastStatus = status;
      bytes = size;
      if (status >= 400) errors++;
    } catch {
      errors++;
    }
  }
  return {
    name,
    method,
    url,
    iter: samples.length,
    errors,
    lastStatus,
    bytes,
    min: Math.min(...samples),
    p50: pct(samples, 0.5),
    p95: pct(samples, 0.95),
    p99: pct(samples, 0.99),
    max: Math.max(...samples),
    avg: samples.reduce((a, b) => a + b, 0) / samples.length,
  };
}

function fmt(n: number): string {
  return Math.round(n).toString().padStart(5);
}

test.describe.serial('GHM-Server perf', () => {
  let auth: APIRequestContext;
  const results: Sample[] = [];

  // capture realistic IDs from the seeded data
  const fixtures = {
    productId: 'PRD-001',
    productId2: 'PRD-002',
    categoryId: 'CAT-01',
    vanId: 'V1',
    invoiceId: 'INV-1001',
    expenseId: 'EXP-001',
    stockEntryId: 'STK-001',
  };

  test.beforeAll(async () => {
    const baseURL = process.env.BASE_URL || 'http://localhost:6397/api/v1/';
    const anon = await request.newContext({ baseURL });
    const loginRes = await anon.post('auth/login', {
      data: { email: EMAIL, password: PASSWORD },
    });
    expect(loginRes.ok(), `login failed: ${await loginRes.text()}`).toBeTruthy();
    const json = await loginRes.json();
    const token = json.accessToken ?? json.access_token ?? json.token;
    expect(token, 'no token in login response').toBeTruthy();

    auth = await request.newContext({
      baseURL,
      extraHTTPHeaders: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  });

  test('benchmark all read endpoints', async () => {
    const reads: Array<[string, Method, string, unknown?]> = [
      // Health (public — anon ctx not needed, auth ctx works too)
      ['health.live', 'GET', '/health/liveness'],
      ['health.ready', 'GET', '/health/readiness'],
      ['health.root', 'GET', '/health'],

      // Auth
      ['auth.me', 'GET', '/auth/me'],

      // Categories
      ['categories.list', 'GET', '/categories'],
      ['categories.dailyStats', 'GET', '/categories/stats/daily'],
      ['categories.byId', 'GET', `/categories/${fixtures.categoryId}`],

      // Products  ← high-traffic from frontend
      ['products.list.default', 'GET', '/products?page=1&pageSize=20'],
      ['products.list.large', 'GET', '/products?page=1&pageSize=200'],
      ['products.list.search', 'GET', '/products?q=tomato'],
      ['products.list.byCategory', 'GET', `/products?categoryId=${fixtures.categoryId}`],
      ['products.list.activeOnly', 'GET', '/products?status=Active'],
      ['products.byId', 'GET', `/products/${fixtures.productId}`],
      ['products.history', 'GET', `/products/${fixtures.productId}/history`],

      // Stock entries
      ['stockEntries.list', 'GET', '/stock-entries?page=1&pageSize=20'],
      ['stockEntries.byProduct', 'GET', `/stock-entries?productId=${fixtures.productId}`],
      ['stockEntries.byId', 'GET', `/stock-entries/${fixtures.stockEntryId}`],

      // Stock adjustments
      ['stockAdj.list', 'GET', '/stock-adjustments?page=1&pageSize=20'],
      ['stockAdj.byLot', 'GET', '/stock-adjustments/by-lot'],
      ['stockAdj.audit', 'GET', '/stock-adjustments/audit?page=1&pageSize=20'],

      // Vans
      ['vans.list', 'GET', '/vans'],
      ['vans.byId', 'GET', `/vans/${fixtures.vanId}`],
      ['vans.distribution.today', 'GET', `/vans/${fixtures.vanId}/distribution`],

      // Sales
      ['sales.lastForVan', 'GET', `/sales/last?vanId=${fixtures.vanId}`],

      // Invoices  ← high-traffic
      ['invoices.list', 'GET', '/invoices?page=1&pageSize=20'],
      ['invoices.list.paid', 'GET', '/invoices?status=paid'],
      ['invoices.list.unpaid', 'GET', '/invoices?status=unpaid'],
      ['invoices.byId', 'GET', `/invoices/${fixtures.invoiceId}`],
      ['invoices.export', 'GET', '/invoices/export'],

      // Expenses
      ['expenses.list', 'GET', '/expenses?page=1&pageSize=20'],
      ['expenses.list.fuel', 'GET', '/expenses?category=Fuel'],
      ['expenses.byId', 'GET', `/expenses/${fixtures.expenseId}`],
      ['expenses.export', 'GET', '/expenses/export'],

      // Dashboard  ← almost certainly the slow ones
      ['dashboard.metrics', 'GET', '/dashboard/metrics'],
      ['dashboard.series.daily', 'GET', '/dashboard/series?timeframe=daily'],
      ['dashboard.series.weekly', 'GET', '/dashboard/series?timeframe=weekly'],
      ['dashboard.series.monthly', 'GET', '/dashboard/series?timeframe=monthly'],
      ['dashboard.series.yearly', 'GET', '/dashboard/series?timeframe=yearly'],
      ['dashboard.vansPerformance', 'GET', '/dashboard/vans/performance'],
      ['dashboard.categoriesBreakdown', 'GET', '/dashboard/categories/breakdown'],
      ['dashboard.lowStock', 'GET', '/dashboard/alerts/low-stock?threshold=20'],
      ['dashboard.activity', 'GET', '/dashboard/activity?limit=10'],

      // Accounting
      ['accounting.ledger', 'GET', '/accounting/ledger'],
      ['accounting.vanProfitability', 'GET', '/accounting/van-profitability'],

      // Reports
      ['reports.sales', 'GET', '/reports/sales'],
      ['reports.expenses', 'GET', '/reports/expenses'],
      ['reports.stock', 'GET', '/reports/stock'],

      // Search
      ['search.all', 'GET', '/search?q=tomato'],
      ['search.sales.7d', 'GET', '/search?kind=sales&dateRange=7d'],
    ];

    for (const [name, method, url, body] of reads) {
      const r = await bench(auth, name, method, url, body);
      results.push(r);
      console.log(
        `  ${name.padEnd(32)} ${method.padEnd(5)} p50=${fmt(r.p50)}ms p95=${fmt(r.p95)}ms p99=${fmt(r.p99)}ms n=${r.iter} errs=${r.errors} status=${r.lastStatus} bytes=${r.bytes}`,
      );
    }
  });

  test('smoke-write endpoints (1 sample each, side-effects expected)', async () => {
    // These create real rows; we keep iter=1 so we don't pollute the DB.
    // For perf signal, look at avg latency in the report.
    const today = new Date().toISOString().slice(0, 10);

    const writes: Array<[string, Method, string, unknown?]> = [
      [
        'expenses.create',
        'POST',
        '/expenses',
        {
          date: today,
          category: 'Fuel',
          amount: 500,
          description: 'PERF-TEST diesel',
          status: 'paid',
          vanId: fixtures.vanId,
        },
      ],
      [
        'stockEntries.create',
        'POST',
        '/stock-entries',
        {
          date: today,
          productId: fixtures.productId,
          quantity: 5,
          buyingRate: 38,
          source: 'PERF-TEST market',
        },
      ],
      [
        'invoices.markPaid',
        'PATCH',
        `/invoices/${fixtures.invoiceId}`,
        { status: 'paid' },
      ],
    ];

    for (const [name, method, url, body] of writes) {
      const r = await bench(auth, name, method, url, body, 1, 0);
      results.push(r);
      console.log(
        `  ${name.padEnd(32)} ${method.padEnd(5)} avg=${fmt(r.avg)}ms status=${r.lastStatus} errs=${r.errors}`,
      );
    }
  });

  test.afterAll(async () => {
    if (results.length === 0) return;

    const outDir = path.resolve(__dirname);
    fs.writeFileSync(
      path.join(outDir, 'report.json'),
      JSON.stringify(
        { ranAt: new Date().toISOString(), iter: ITER, warmup: WARMUP, results },
        null,
        2,
      ),
    );

    // Sort by p95 desc to surface worst offenders
    const sorted = [...results].sort((a, b) => b.p95 - a.p95);
    const lines: string[] = [];
    lines.push(`# GHM-Server API Perf Report`);
    lines.push('');
    lines.push(`- Run at: ${new Date().toISOString()}`);
    lines.push(`- Iterations per endpoint: ${ITER} (warmup ${WARMUP})`);
    lines.push(`- Slow threshold (p95 > ${SLOW_P95_MS}ms) flagged with **SLOW**`);
    lines.push('');
    lines.push(`## Endpoints sorted by p95 (slowest first)`);
    lines.push('');
    lines.push(
      '| # | Endpoint | Method | p50 | p95 | p99 | max | avg | n | errs | status | bytes |',
    );
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    sorted.forEach((r, i) => {
      const slow = r.p95 > SLOW_P95_MS ? ' **SLOW**' : '';
      lines.push(
        `| ${i + 1} | \`${r.name}\`${slow} | ${r.method} \`${r.url}\` | ${Math.round(r.p50)} | ${Math.round(r.p95)} | ${Math.round(r.p99)} | ${Math.round(r.max)} | ${Math.round(r.avg)} | ${r.iter} | ${r.errors} | ${r.lastStatus} | ${r.bytes} |`,
      );
    });
    fs.writeFileSync(path.join(outDir, 'REPORT.md'), lines.join('\n'));

    const slowOnes = sorted.filter((r) => r.p95 > SLOW_P95_MS);
    console.log(
      `\n  Wrote perf/report.json and perf/REPORT.md (${results.length} endpoints, ${slowOnes.length} > ${SLOW_P95_MS}ms p95)`,
    );
  });
});
