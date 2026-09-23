import {
  BankTransactionType,
  ExpenseStatus,
  InvoiceStatus,
  PrismaClient,
  ProductUnit,
  PurchaseStatus,
  TransactionType,
  UserRole,
} from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

async function bumpSeq(prefix: string, count: number, width = 3) {
  await prisma.idSequence.upsert({
    where: { prefix },
    create: { prefix, next: count + 1, width },
    update: { next: count + 1, width },
  });
}

function dateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

async function main() {
  console.log('Seeding…');

  // ── Wipe everything (FK-safe order) ──────────────────────
  await prisma.distributionOrderLine.deleteMany();
  await prisma.distributionOrder.deleteMany();
  await prisma.bankTransaction.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.stockLotAllocation.deleteMany();
  await prisma.stockAdjustment.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.distributionLine.deleteMany();
  await prisma.distribution.deleteMany();
  await prisma.purchaseLine.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.stockEntry.deleteMany();
  await prisma.stockBatch.deleteMany();
  await prisma.bankAccount.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.van.deleteMany();
  await prisma.idSequence.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();

  // ── Users ────────────────────────────────────────────────
  const passwordHash = await argon2.hash('admin1234');
  await prisma.user.createMany({
    data: [
      { email: 'admin@ghm.local', name: 'Admin', role: UserRole.ADMIN, passwordHash },
      { email: 'manager@ghm.local', name: 'Manager', role: UserRole.MANAGER, passwordHash },
      { email: 'staff@ghm.local', name: 'Staff', role: UserRole.STAFF, passwordHash },
    ],
  });

  // ── Vans ─────────────────────────────────────────────────
  await prisma.van.createMany({
    data: [
      { id: 'V1', vanName: 'Van 1 - North', driver: 'Rahim' },
      { id: 'V2', vanName: 'Van 2 - South', driver: 'Karim' },
      { id: 'V3', vanName: 'Van 3 - East', driver: 'Jamal' },
    ],
  });

  // ── Categories ───────────────────────────────────────────
  const categoryData = [
    { id: 'CAT-01', name: 'Vegetable' },
    { id: 'CAT-02', name: 'Root' },
    { id: 'CAT-03', name: 'Spice' },
    { id: 'CAT-04', name: 'Leafy' },
    { id: 'CAT-05', name: 'Fruit' },
    { id: 'CAT-06', name: 'Dairy' },
  ];
  for (const c of categoryData) {
    await prisma.category.create({ data: { id: c.id, name: c.name } });
  }

  // ── Products (no opening stock — comes from purchases) ───
  const products: Array<{
    id: string; name: string; categoryId: string; unit: ProductUnit;
    basePrice: number; tradePrice: number;
  }> = [
    { id: 'PRD-001', name: 'Premium Tomato', categoryId: 'CAT-01', unit: ProductUnit.kg, basePrice: 40, tradePrice: 60 },
    { id: 'PRD-002', name: 'Onion', categoryId: 'CAT-02', unit: ProductUnit.kg, basePrice: 50, tradePrice: 75 },
    { id: 'PRD-003', name: 'Green Chili', categoryId: 'CAT-03', unit: ProductUnit.kg, basePrice: 120, tradePrice: 180 },
    { id: 'PRD-004', name: 'Spinach', categoryId: 'CAT-04', unit: ProductUnit.sack, basePrice: 80, tradePrice: 120 },
    { id: 'PRD-005', name: 'Banana', categoryId: 'CAT-05', unit: ProductUnit.crate, basePrice: 250, tradePrice: 350 },
    { id: 'PRD-006', name: 'Potato', categoryId: 'CAT-02', unit: ProductUnit.kg, basePrice: 30, tradePrice: 45 },
    { id: 'PRD-007', name: 'Carrot', categoryId: 'CAT-02', unit: ProductUnit.kg, basePrice: 55, tradePrice: 80 },
    { id: 'PRD-008', name: 'Cucumber', categoryId: 'CAT-01', unit: ProductUnit.kg, basePrice: 35, tradePrice: 55 },
  ];
  await prisma.product.createMany({ data: products.map(p => ({ ...p, stock: 0 })) });
  await bumpSeq('PRD', products.length);

  // ── Bank account ─────────────────────────────────────────
  const bank = await prisma.bankAccount.create({
    data: {
      bankName: 'Dutch-Bangla Bank',
      accountNumber: '1011234567890',
      accountHolder: 'GHM Trading',
      balance: 200_000,
    },
  });

  // ── Helpers for purchase batches ─────────────────────────
  const today = dateOnly(new Date());
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  };

  type BatchSpec = {
    batchId: string;
    purchaseId: string;
    date: Date;
    source: string;
    notes?: string;
    payFromBank: boolean;
    transport: number;
    labour: number;
    other: number;
    lines: Array<{
      stockId: string;
      productId: string;
      quantity: number;
      basePrice: number;
      profitPercent?: number;
      sellPrice?: number;
    }>;
  };

  const batches: BatchSpec[] = [
    {
      batchId: 'BAT-001', purchaseId: 'PUR-001', date: daysAgo(3),
      source: 'Karwan Bazar', notes: 'Morning haul', payFromBank: true,
      transport: 800, labour: 400, other: 0,
      lines: [
        { stockId: 'STK-001', productId: 'PRD-001', quantity: 100, basePrice: 38, profitPercent: 55 },
        { stockId: 'STK-002', productId: 'PRD-002', quantity: 80,  basePrice: 48, profitPercent: 55 },
        { stockId: 'STK-003', productId: 'PRD-003', quantity: 20,  basePrice: 115, sellPrice: 180 },
      ],
    },
    {
      batchId: 'BAT-002', purchaseId: 'PUR-002', date: daysAgo(2),
      source: 'Gazipur Central Market', notes: 'Bulk run', payFromBank: true,
      transport: 1200, labour: 600, other: 200,
      lines: [
        { stockId: 'STK-004', productId: 'PRD-004', quantity: 25, basePrice: 78, profitPercent: 50 },
        { stockId: 'STK-005', productId: 'PRD-005', quantity: 10, basePrice: 240, profitPercent: 45 },
        { stockId: 'STK-006', productId: 'PRD-006', quantity: 200, basePrice: 28, profitPercent: 55 },
        { stockId: 'STK-007', productId: 'PRD-007', quantity: 60, basePrice: 52, profitPercent: 55 },
      ],
    },
    {
      batchId: 'BAT-003', purchaseId: 'PUR-003', date: daysAgo(1),
      source: 'Mohakhali Wholesale', notes: 'Afternoon top-up', payFromBank: false,
      transport: 400, labour: 200, other: 0,
      lines: [
        { stockId: 'STK-008', productId: 'PRD-008', quantity: 50, basePrice: 33, profitPercent: 60 },
        { stockId: 'STK-009', productId: 'PRD-001', quantity: 60, basePrice: 42, profitPercent: 50 },
      ],
    },
    {
      batchId: 'BAT-004', purchaseId: 'PUR-004', date: today,
      source: 'Karwan Bazar', notes: 'Today\'s fresh delivery', payFromBank: true,
      transport: 900, labour: 500, other: 100,
      lines: [
        { stockId: 'STK-010', productId: 'PRD-002', quantity: 120, basePrice: 49, profitPercent: 52 },
        { stockId: 'STK-011', productId: 'PRD-003', quantity: 15,  basePrice: 118, profitPercent: 50 },
        { stockId: 'STK-012', productId: 'PRD-004', quantity: 18,  basePrice: 82, profitPercent: 48 },
        { stockId: 'STK-013', productId: 'PRD-007', quantity: 40,  basePrice: 54, profitPercent: 55 },
        { stockId: 'STK-014', productId: 'PRD-008', quantity: 35,  basePrice: 36, profitPercent: 55 },
      ],
    },
  ];

  let lastBank = bank.balance;

  for (const b of batches) {
    const totalQty = b.lines.reduce((s, l) => s + l.quantity, 0);
    const sharedTotal = b.transport + b.labour + b.other;
    let allocatedShared = 0;

    // Compute per-line shared cost split (last line absorbs rounding)
    const computed = b.lines.map((l, idx) => {
      const isLast = idx === b.lines.length - 1;
      const share = totalQty > 0 ? l.quantity / totalQty : 0;
      const lineShared = isLast
        ? sharedTotal - allocatedShared
        : Math.floor(sharedTotal * share);
      if (!isLast) allocatedShared += lineShared;
      const lineTotal = l.basePrice * l.quantity + lineShared;
      const effective = l.quantity > 0 ? Math.round(lineTotal / l.quantity) : 0;
      const sell = l.sellPrice
        ? l.sellPrice
        : l.profitPercent
          ? Math.round(effective * (1 + l.profitPercent / 100))
          : 0;
      return { ...l, lineShared, lineTotal, effective, sell };
    });

    const purchaseTotal = computed.reduce((s, c) => s + c.lineTotal, 0);

    // 1) StockBatch
    await prisma.stockBatch.create({
      data: {
        id: b.batchId, date: b.date, source: b.source, notes: b.notes ?? null,
      },
    });

    // 2) StockEntry per line + product update + activity transaction
    for (const c of computed) {
      await prisma.stockEntry.create({
        data: {
          id: c.stockId, date: b.date, productId: c.productId,
          batchId: b.batchId, quantity: c.quantity,
          remainingQuantity: c.quantity, basePrice: c.effective,
          source: b.source, notes: b.notes ?? null,
        },
      });
      await prisma.product.update({
        where: { id: c.productId },
        data: {
          basePrice: c.effective,
          ...(c.sell > 0 ? { tradePrice: c.sell } : {}),
          stock: { increment: c.quantity },
        },
      });
      await prisma.transaction.create({
        data: {
          occurredAt: new Date(),
          amount: c.quantity * c.effective,
          type: TransactionType.stock,
          description: `Batch ${b.batchId}: +${c.quantity} ${c.productId} from ${b.source}`,
          refTable: 'stock_entries',
          refId: c.stockId,
        },
      });
    }

    // 3) Purchase + PurchaseLine
    await prisma.purchase.create({
      data: {
        id: b.purchaseId, date: b.date, source: b.source,
        notes: b.notes ?? null,
        status: PurchaseStatus.confirmed,
        bankAccountId: b.payFromBank ? bank.id : null,
        batchId: b.batchId,
        total: purchaseTotal,
        lines: {
          create: computed.map(c => ({
            productId: c.productId,
            quantity: c.quantity,
            basePrice: c.basePrice,
            transportCost: 0,
            labourCost: 0,
            otherCost: c.lineShared,
            effectiveBuyPrice: c.effective,
            sellPrice: c.sell,
            profitPercent: c.profitPercent ?? null,
          })),
        },
      },
    });

    // 4) Bank withdrawal if paid via bank
    if (b.payFromBank) {
      lastBank -= purchaseTotal;
      await prisma.bankAccount.update({
        where: { id: bank.id },
        data: { balance: lastBank },
      });
      await prisma.bankTransaction.create({
        data: {
          bankAccountId: bank.id,
          type: BankTransactionType.withdrawal,
          amount: purchaseTotal,
          description: `Purchase ${b.purchaseId} — ${b.source}`,
          occurredAt: b.date,
        },
      });
      await prisma.transaction.create({
        data: {
          occurredAt: new Date(),
          amount: -purchaseTotal,
          type: TransactionType.purchase,
          description: `Purchase ${b.purchaseId} from ${b.source}`,
          refTable: 'purchases',
          refId: b.purchaseId,
        },
      });
    }
  }

  await bumpSeq('BAT', batches.length);
  await bumpSeq('STK', batches.reduce((s, b) => s + b.lines.length, 0));
  await bumpSeq('PUR', batches.length);

  // ── Distribution for V1 today (consumes from BAT-004) ────
  await prisma.distribution.create({
    data: {
      id: 'DST-001', vanId: 'V1', date: today,
      lines: {
        create: [
          { productId: 'PRD-002', allocated: 40, returned: 5 },
          { productId: 'PRD-007', allocated: 20, returned: 2 },
        ],
      },
    },
  });
  await bumpSeq('DST', 1);

  // ── Invoices + sales ─────────────────────────────────────
  const invoiceData = [
    {
      id: 'INV-1001', vanId: 'V1', total: 2400, status: InvoiceStatus.paid,
      items: [
        { productId: 'PRD-001', name: 'Premium Tomato', price: 60, qty: 30, subtotal: 1800 },
        { productId: 'PRD-002', name: 'Onion', price: 75, qty: 8, subtotal: 600 },
      ],
    },
    {
      id: 'INV-1002', vanId: 'V2', total: 1080, status: InvoiceStatus.unpaid,
      items: [{ productId: 'PRD-003', name: 'Green Chili', price: 180, qty: 6, subtotal: 1080 }],
    },
  ];
  for (const inv of invoiceData) {
    await prisma.invoice.create({
      data: {
        id: inv.id, vanId: inv.vanId, date: today, total: inv.total,
        status: inv.status,
        paidAt: inv.status === InvoiceStatus.paid ? new Date() : null,
        items: { create: inv.items },
      },
    });
    await prisma.sale.create({
      data: {
        id: `SAL-${pad(invoiceData.indexOf(inv) + 1, 3)}`,
        vanId: inv.vanId, date: today, total: inv.total,
        invoiceId: inv.id,
        items: {
          create: inv.items.map(it => ({
            productId: it.productId, price: it.price, qty: it.qty,
          })),
        },
      },
    });
    await prisma.transaction.create({
      data: {
        occurredAt: new Date(), amount: inv.total,
        type: TransactionType.sale,
        description: `Sale on ${inv.vanId} (${inv.items.length} items)`,
        refTable: 'invoices', refId: inv.id,
      },
    });
  }
  await bumpSeq('INV', 1002, 4);
  await bumpSeq('SAL', invoiceData.length);

  // ── Expenses ─────────────────────────────────────────────
  const expenses: Array<{
    id: string; category: string; amount: number; description: string;
    status: ExpenseStatus; vanId: string | null;
  }> = [
    { id: 'EXP-001', category: 'Fuel', amount: 1200, description: 'Diesel for V1', status: ExpenseStatus.paid, vanId: 'V1' },
    { id: 'EXP-002', category: 'Market Fees', amount: 350, description: 'Stall fee Gazipur', status: ExpenseStatus.pending, vanId: null },
  ];
  await prisma.expense.createMany({
    data: expenses.map(e => ({ ...e, date: today })),
  });
  await bumpSeq('EXP', expenses.length);
  for (const e of expenses) {
    await prisma.transaction.create({
      data: {
        occurredAt: new Date(), amount: -e.amount,
        type: TransactionType.expense,
        description: `${e.category}: ${e.description}`,
        refTable: 'expenses', refId: e.id,
      },
    });
  }

  console.log(`Seed complete. ${batches.length} batches, ${batches.reduce((s, b) => s + b.lines.length, 0)} stock entries.`);
  console.log('Login: admin@ghm.local / admin1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
