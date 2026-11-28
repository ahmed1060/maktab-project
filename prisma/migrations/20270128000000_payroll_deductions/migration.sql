-- Payroll deductions (LATER_CHANGES_PLAN.md §7.12, step 9a, PR 440): what a
-- company takes from every payslip, income tax, social insurance and its
-- own. Only adds: a table and its two kinds, empty until a company sets
-- one, so no payslip changes.
CREATE TYPE "PayrollDeductionKind" AS ENUM ('INCOME_TAX', 'SOCIAL_INSURANCE', 'OTHER');
CREATE TYPE "PayrollDeductionBasis" AS ENUM ('PERCENT', 'AMOUNT');

CREATE TABLE "PayrollDeduction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "PayrollDeductionKind" NOT NULL,
    "name" TEXT,
    "basis" "PayrollDeductionBasis" NOT NULL DEFAULT 'PERCENT',
    "value" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollDeduction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayrollDeduction_companyId_idx" ON "PayrollDeduction"("companyId");

-- A company's go with it.
ALTER TABLE "PayrollDeduction" ADD CONSTRAINT "PayrollDeduction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What the schema can't say: income tax and social insurance are a
-- percentage, with no name, one each at most; the company's own have a name,
-- and two of them can't share one, ignoring capitals and the spaces around
-- it; a percentage is 0 to 100 and an amount 0 or more.
ALTER TABLE "PayrollDeduction" ADD CONSTRAINT "PayrollDeduction_named_own" CHECK (
    ("kind" = 'OTHER' AND "name" IS NOT NULL AND length(btrim("name")) > 0)
    OR ("kind" <> 'OTHER' AND "name" IS NULL AND "basis" = 'PERCENT')
);
ALTER TABLE "PayrollDeduction" ADD CONSTRAINT "PayrollDeduction_value_range" CHECK (
    "value" >= 0 AND ("basis" = 'AMOUNT' OR "value" <= 100)
);
CREATE UNIQUE INDEX "PayrollDeduction_one_built_in" ON "PayrollDeduction"("companyId", "kind") WHERE "kind" <> 'OTHER';
CREATE UNIQUE INDEX "PayrollDeduction_own_name" ON "PayrollDeduction"("companyId", lower(btrim("name"))) WHERE "kind" = 'OTHER';

-- What an approved month was approved with, so a later change never
-- restates it. Empty on the months approved before, which had none.
ALTER TABLE "PayrollRun" ADD COLUMN "payrollDeductions" JSONB;

-- Every table has Row Level Security on (DATABASE_SETUP.md).
ALTER TABLE "PayrollDeduction" ENABLE ROW LEVEL SECURITY;
