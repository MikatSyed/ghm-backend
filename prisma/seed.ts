import {
  ExpenseStatus,
  InvoiceStatus,
  PrismaClient,
  ProductUnit,
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

async function main() {
  console.log('Seeding…');

  await prisma.transaction.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.distributionLine.deleteMany();
  await prisma.distribution.deleteMany();
  await prisma.stockEntry.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.product.deleteMany();
  await prisma.van.deleteMany();
  await prisma.idSequence.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await argon2.hash('admin1234');
  await prisma.user.createMany({
    data: [
      { email: 'admin@ghm.local', name: 'Admin', role: UserRole.ADMIN, passwordHash },
      { email: 'manager@ghm.local', name: 'Manager', role: UserRole.MANAGER, passwordHash },
      { email: 'staff@ghm.local', name: 'Staff', role: UserRole.STAFF, passwordHash },
    ],
  });

  await prisma.van.createMany({
    data: [
      { id: 'V1', vanName: 'Van 1 - North', driver: 'Rahim' },
      { id: 'V2', vanName: 'Van 2 - South', driver: 'Karim' },
      { id: 'V3', vanName: 'Van 3 - East', driver: 'Jamal' },
    ],
  });

  const categoryData = [
    { id: 'CAT-01', name: 'Vegetable' },
    { id: 'CAT-02', name: 'Root' },
    { id: 'CAT-03', name: 'Spice' },
    { id: 'CAT-04', name: 'Leafy' },
    { id: 'CAT-05', name: 'Fruit' },
    { id: 'CAT-06', name: 'Dairy' },
  ];
  for (const c of categoryData) {
    await prisma.category.upsert({
      where: { name: c.name },
      update: {},
      create: { id: c.id, name: c.name },
    });
  }

  const products: Array<{
    id: string;
    name: string;
    categoryId: string;
    unit: ProductUnit;
    buyPrice: number;
    sellPrice: number;
    stock: number;
  }> = [
    { id: 'PRD-001', name: 'Premium Tomato', categoryId: 'CAT-01', unit: ProductUnit.kg, buyPrice: 40, sellPrice: 60, stock: 200 },
    { id: 'PRD-002', name: 'Onion', categoryId: 'CAT-02', unit: ProductUnit.kg, buyPrice: 50, sellPrice: 75, stock: 150 },
    { id: 'PRD-003', name: 'Green Chili', categoryId: 'CAT-03', unit: ProductUnit.kg, buyPrice: 120, sellPrice: 180, stock: 30 },
    { id: 'PRD-004', name: 'Spinach', categoryId: 'CAT-04', unit: ProductUnit.sack, buyPrice: 80, sellPrice: 120, stock: 25 },
    { id: 'PRD-005', name: 'Banana', categoryId: 'CAT-05', unit: ProductUnit.crate, buyPrice: 250, sellPrice: 350, stock: 8 },
  ];
  await prisma.product.createMany({ data: products });
  await bumpSeq('PRD', products.length);

  const today = new Date();
  const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // Stock entries
  const stockEntries = [
    { id: 'STK-001', productId: 'PRD-001', quantity: 100, buyingRate: 38, source: 'Gazipur Central Market' },
    { id: 'STK-002', productId: 'PRD-002', quantity: 80, buyingRate: 48, source: 'Karwan Bazar' },
    { id: 'STK-003', productId: 'PRD-003', quantity: 20, buyingRate: 115, source: 'Karwan Bazar' },
  ];
  await prisma.stockEntry.createMany({
    data: stockEntries.map((s) => ({ ...s, date: todayDateOnly, remainingQuantity: s.quantity })),
  });
  await bumpSeq('STK', stockEntries.length);

  // Distribution for V1 today
  await prisma.distribution.create({
    data: {
      id: 'DST-001',
      vanId: 'V1',
      date: todayDateOnly,
      lines: {
        create: [
          { productId: 'PRD-001', allocated: 40, returned: 5 },
          { productId: 'PRD-002', allocated: 30, returned: 2 },
        ],
      },
    },
  });
  await bumpSeq('DST', 1);

  // Invoices + sales
  const invoiceData = [
    {
      id: 'INV-1001',
      vanId: 'V1',
      total: 2400,
      status: InvoiceStatus.paid,
      items: [
        { productId: 'PRD-001', name: 'Premium Tomato', price: 60, qty: 30, subtotal: 1800 },
        { productId: 'PRD-002', name: 'Onion', price: 75, qty: 8, subtotal: 600 },
      ],
    },
    {
      id: 'INV-1002',
      vanId: 'V2',
      total: 1080,
      status: InvoiceStatus.unpaid,
      items: [{ productId: 'PRD-003', name: 'Green Chili', price: 180, qty: 6, subtotal: 1080 }],
    },
  ];
  for (const inv of invoiceData) {
    await prisma.invoice.create({
      data: {
        id: inv.id,
        vanId: inv.vanId,
        date: todayDateOnly,
        total: inv.total,
        status: inv.status,
        paidAt: inv.status === InvoiceStatus.paid ? new Date() : null,
        items: { create: inv.items },
      },
    });
    await prisma.sale.create({
      data: {
        id: `SAL-${pad(invoiceData.indexOf(inv) + 1, 3)}`,
        vanId: inv.vanId,
        date: todayDateOnly,
        total: inv.total,
        invoiceId: inv.id,
        items: {
          create: inv.items.map((it) => ({
            productId: it.productId,
            price: it.price,
            qty: it.qty,
          })),
        },
      },
    });
    await prisma.transaction.create({
      data: {
        occurredAt: new Date(),
        amount: inv.total,
        type: TransactionType.sale,
        description: `Sale on ${inv.vanId} (${inv.items.length} items)`,
        refTable: 'invoices',
        refId: inv.id,
      },
    });
  }
  await bumpSeq('INV', 1002, 4);
  await bumpSeq('SAL', invoiceData.length);

  // Expenses
  const expenses: Array<{
    id: string;
    category: string;
    amount: number;
    description: string;
    status: ExpenseStatus;
    vanId: string | null;
  }> = [
    { id: 'EXP-001', category: 'Fuel', amount: 1200, description: 'Diesel for V1', status: ExpenseStatus.paid, vanId: 'V1' },
    { id: 'EXP-002', category: 'Market Fees', amount: 350, description: 'Stall fee Gazipur', status: ExpenseStatus.pending, vanId: null },
  ];
  await prisma.expense.createMany({
    data: expenses.map((e) => ({ ...e, date: todayDateOnly })),
  });
  await bumpSeq('EXP', expenses.length);

  for (const e of expenses) {
    await prisma.transaction.create({
      data: {
        occurredAt: new Date(),
        amount: -e.amount,
        type: TransactionType.expense,
        description: `${e.category}: ${e.description}`,
        refTable: 'expenses',
        refId: e.id,
      },
    });
  }

  console.log('Seed complete. Login: admin@ghm.local / admin1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
