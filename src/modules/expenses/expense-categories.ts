export const EXPENSE_CATEGORIES = [
  'Fuel',
  'Van Rent',
  'Labor Cost',
  'Shipping Cost',
  'Market Fees',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
