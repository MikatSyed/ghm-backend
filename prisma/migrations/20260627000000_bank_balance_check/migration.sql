-- Prevent bank overdraft at the schema level. Catches lost-update races
-- between concurrent purchases against the same account that slip past the
-- in-transaction balance check.
ALTER TABLE "bank_accounts"
  ADD CONSTRAINT "bank_accounts_balance_nonneg" CHECK ("balance" >= 0);
