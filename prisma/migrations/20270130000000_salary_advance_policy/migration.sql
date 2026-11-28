-- The rules a salary advance follows (LATER_CHANGES_PLAN.md §7.5, step 2):
-- columns on the company, each with its default, so every company already
-- there has them as the plan says: 2 months' salary, after 3 months worked,
-- one at a time, 10% an installment and 25% for all debts together, and
-- Block over a limit. Only adds. Nothing reads them until salary advances
-- can be asked for.
CREATE TYPE "SalaryAdvanceOverLimit" AS ENUM ('BLOCK', 'WARN');

ALTER TABLE "Company"
    ADD COLUMN "salaryAdvanceMaxMonths" DECIMAL(4,2) NOT NULL DEFAULT 2,
    ADD COLUMN "salaryAdvanceMinServiceMonths" INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN "salaryAdvanceOneOpen" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "salaryAdvanceInstallmentPercent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    ADD COLUMN "debtsLimitPercent" DECIMAL(5,2) NOT NULL DEFAULT 25,
    ADD COLUMN "salaryAdvanceOverLimit" "SalaryAdvanceOverLimit" NOT NULL DEFAULT 'BLOCK';

-- What the schema can't say, as the card and the server refuse it: months
-- from 0.5 to 12, the months worked first 0 to 120, each percentage 1 to
-- 100, and all debts together never below an installment's.
ALTER TABLE "Company" ADD CONSTRAINT "Company_salaryAdvance_check" CHECK (
    "salaryAdvanceMaxMonths" BETWEEN 0.5 AND 12
    AND "salaryAdvanceMinServiceMonths" BETWEEN 0 AND 120
    AND "salaryAdvanceInstallmentPercent" BETWEEN 1 AND 100
    AND "debtsLimitPercent" BETWEEN 1 AND 100
    AND "debtsLimitPercent" >= "salaryAdvanceInstallmentPercent"
);
