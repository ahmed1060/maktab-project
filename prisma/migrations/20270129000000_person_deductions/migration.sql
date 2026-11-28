-- A person's payroll deductions (LATER_CHANGES_PLAN.md §7.12, step 9b, PR
-- 442): for each of the company's deductions, their own figure in its place,
-- or not applied to them. As the company is no row. Only adds: a table and
-- its kind, empty until someone's set, and a column on PayrollRun empty on
-- every month approved before, so no payslip changes.
CREATE TYPE "PersonDeductionMode" AS ENUM ('OWN', 'NONE');

CREATE TABLE "PersonDeduction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deductionId" TEXT NOT NULL,
    "mode" "PersonDeductionMode" NOT NULL,
    "value" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonDeduction_pkey" PRIMARY KEY ("id")
);

-- One for each person and deduction; payroll reads them by the deduction's company.
CREATE UNIQUE INDEX "PersonDeduction_userId_deductionId_key" ON "PersonDeduction"("userId", "deductionId");
CREATE INDEX "PersonDeduction_deductionId_idx" ON "PersonDeduction"("deductionId");

-- Gone with the person, and with the deduction.
ALTER TABLE "PersonDeduction" ADD CONSTRAINT "PersonDeduction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonDeduction" ADD CONSTRAINT "PersonDeduction_deductionId_fkey" FOREIGN KEY ("deductionId") REFERENCES "PayrollDeduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What the schema can't say: their own has a figure, 0 or more, in the
-- deduction's kind (a percentage's 100 at most is the server's to check, as
-- the kind is the deduction's); not applied has none.
ALTER TABLE "PersonDeduction" ADD CONSTRAINT "PersonDeduction_figure" CHECK (
    ("mode" = 'OWN' AND "value" IS NOT NULL AND "value" >= 0)
    OR ("mode" = 'NONE' AND "value" IS NULL)
);

-- What each person's were at approval, so a later change never restates an
-- approved month. Empty on the months approved before, which had none.
ALTER TABLE "PayrollRun" ADD COLUMN "personDeductions" JSONB;

-- Every table has Row Level Security on (DATABASE_SETUP.md).
ALTER TABLE "PersonDeduction" ENABLE ROW LEVEL SECURITY;
