-- An adjustment gains a period and a provenance.
--
-- Additive: four nullable columns, backfilled, then made NOT NULL where they
-- must be. Nothing existing is dropped or rewritten in place.

ALTER TABLE "SalaryAdjustment" ADD COLUMN "month" INTEGER;
ALTER TABLE "SalaryAdjustment" ADD COLUMN "year" INTEGER;
ALTER TABLE "SalaryAdjustment" ADD COLUMN "source" TEXT;
ALTER TABLE "SalaryAdjustment" ADD COLUMN "sourceId" TEXT;

-- The period, from createdAt in the company's calendar.
--
-- This is the one backfill that is exactly faithful rather than a guess: it is
-- precisely what the code did at every read site until this migration, so
-- every existing row keeps the month it has always been treated as having.
-- Going forward the period is supplied by the writer and never inferred again.
--
-- createdAt is `timestamp without time zone` holding UTC, so it is interpreted
-- as UTC first and only then converted — the single-step form would read the
-- stored wall clock as Cairo local and land two or three hours out. The zone
-- is spelled here rather than read from lib/time.ts because a migration is a
-- statement about the past, and Cairo is the zone those rows were written
-- under; the Company.timezone column that arrives in migration 4 governs rows
-- written after it, not these.
UPDATE "SalaryAdjustment"
SET
    "month" = EXTRACT(MONTH FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo')::int,
    "year"  = EXTRACT(YEAR  FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo')::int
WHERE "month" IS NULL;

-- Provenance, from the reason text.
--
-- String matching, deliberately, and only here: this is a one-off statement
-- over rows that already exist, where the reason is the only evidence of where
-- each came from. The runtime lookup it replaces — day-off finding its own
-- adjustment with `reason: { contains: id }` — was the same technique applied
-- forever, against a field an admin can edit.
UPDATE "SalaryAdjustment"
SET "source" = 'TASK_PENALTY'
WHERE "source" IS NULL AND "reason" = 'Lateness Penalty Deduction';

UPDATE "SalaryAdjustment"
SET
    "source" = 'DAY_OFF',
    "sourceId" = substring("reason" from 'Day off deduction for request #(.*)$')
WHERE "source" IS NULL AND "reason" LIKE 'Day off deduction for request #%';

UPDATE "SalaryAdjustment" SET "source" = 'MANUAL' WHERE "source" IS NULL;

ALTER TABLE "SalaryAdjustment" ALTER COLUMN "month" SET NOT NULL;
ALTER TABLE "SalaryAdjustment" ALTER COLUMN "year" SET NOT NULL;
ALTER TABLE "SalaryAdjustment" ALTER COLUMN "source" SET NOT NULL;
ALTER TABLE "SalaryAdjustment" ALTER COLUMN "source" SET DEFAULT 'MANUAL';

CREATE INDEX "SalaryAdjustment_userId_year_month_idx" ON "SalaryAdjustment"("userId", "year", "month");
CREATE INDEX "SalaryAdjustment_source_sourceId_idx" ON "SalaryAdjustment"("source", "sourceId");

-- A reconstructed leave snapshot can say so.
--
-- The January reset now writes a row for every missed year rather than one.
-- Only the first of those carries a balance anybody measured; the rest are
-- reconstructions, and this column is how they admit it.
ALTER TABLE "DayOffCreditSnapshot" ADD COLUMN "note" TEXT;
