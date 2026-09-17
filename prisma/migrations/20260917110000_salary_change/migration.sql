-- Every salary a person has been on, and from when.
--
-- Additive: no existing column or row is modified. The backfill below only
-- inserts, and only for users who have no row yet, so re-running it is safe.
CREATE TABLE "SalaryChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthlyAmount" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalaryChange_userId_effectiveFrom_idx" ON "SalaryChange"("userId", "effectiveFrom");

ALTER TABLE "SalaryChange" ADD CONSTRAINT "SalaryChange_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one row per existing user, carrying their current salary.
--
-- effectiveFrom is the epoch rather than a hire date because there is no hire
-- date to use — User has no createdAt, and inventing one would put a false fact
-- in the column that every future payslip reads. The epoch says exactly what is
-- known: this is the rate, and when it started is not recorded. The reason
-- column says so in words, so nobody later mistakes it for a real decision.
--
-- Without this, splitMonth has no rate in effect for any month before a user's
-- first real change, and every historical payslip would refuse to compute.
INSERT INTO "SalaryChange" ("id", "userId", "monthlyAmount", "effectiveFrom", "reason", "createdById", "createdAt")
SELECT
    gen_random_uuid()::text,
    u."id",
    u."salary",
    TIMESTAMP '1970-01-01 00:00:00',
    'Backfilled from the current salary. The date this rate actually began is not recorded.',
    NULL,
    CURRENT_TIMESTAMP
FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "SalaryChange" sc WHERE sc."userId" = u."id");
