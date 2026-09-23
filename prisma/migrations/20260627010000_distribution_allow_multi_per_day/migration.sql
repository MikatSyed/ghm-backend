-- Allow multiple distributions per (van, date) so vans can come back for
-- mid-day top-ups without crashing the create endpoint. Replace the unique
-- index with a plain index for query performance.
DROP INDEX IF EXISTS "distributions_vanId_date_key";
CREATE INDEX IF NOT EXISTS "distributions_vanId_date_idx" ON "distributions"("vanId", "date");
