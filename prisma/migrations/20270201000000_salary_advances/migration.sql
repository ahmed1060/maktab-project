-- Salary advances asked for (LATER_CHANGES_PLAN.md §7.5, step 3a, PR 449):
-- money lent ahead of the salary, paid back from payslips with no interest.
-- Only adds: a table and its status, empty until someone asks for one.
CREATE TYPE "SalaryAdvanceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

CREATE TABLE "SalaryAdvance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "months" INTEGER NOT NULL,
    "firstYear" INTEGER NOT NULL,
    "firstMonth" INTEGER NOT NULL,
    "status" "SalaryAdvanceStatus" NOT NULL DEFAULT 'PENDING',
    "salary" DECIMAL(12,2) NOT NULL,
    "netPay" DECIMAL(12,2) NOT NULL,
    "otherDebts" DECIMAL(12,2) NOT NULL,
    "overInstallment" BOOLEAN NOT NULL DEFAULT false,
    "overDebts" BOOLEAN NOT NULL DEFAULT false,
    "consentText" TEXT NOT NULL,
    "consentLocale" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryAdvance_pkey" PRIMARY KEY ("id")
);

-- A person's, by status, as only one may be open; the company's, as approving reads them.
CREATE INDEX "SalaryAdvance_companyId_status_idx" ON "SalaryAdvance"("companyId", "status");
CREATE INDEX "SalaryAdvance_userId_status_idx" ON "SalaryAdvance"("userId", "status");

-- Gone with the person, and with the company.
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What the schema can't say: an amount above 0, paid back over 1 to 24
-- months from a real month, measured against figures 0 or more, the consent
-- in one of the two languages, and withdrawn exactly when it's withdrawn.
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_figures" CHECK (
    "amount" > 0
    AND "months" BETWEEN 1 AND 24
    AND "firstMonth" BETWEEN 1 AND 12
    AND "firstYear" BETWEEN 2000 AND 2999
    AND "salary" >= 0 AND "netPay" >= 0 AND "otherDebts" >= 0
    AND "consentLocale" IN ('en', 'ar')
    AND length("consentText") > 0
    AND (("status" = 'WITHDRAWN') = ("withdrawnAt" IS NOT NULL))
);

-- Every table has Row Level Security on (DATABASE_SETUP.md).
ALTER TABLE "SalaryAdvance" ENABLE ROW LEVEL SECURITY;

-- The Requests page and the count on Requests in the side bar draw
-- themselves again when one is asked for or withdrawn, as for every other
-- kind (prisma/migrations/20261210000000_live_requests): its function for a
-- request that carries its company.
CREATE TRIGGER "live_requests_inserted" AFTER INSERT ON "SalaryAdvance"
    REFERENCING NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_requests_changed();
CREATE TRIGGER "live_requests_updated" AFTER UPDATE ON "SalaryAdvance"
    REFERENCING OLD TABLE AS live_old NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_requests_changed();
CREATE TRIGGER "live_requests_deleted" AFTER DELETE ON "SalaryAdvance"
    REFERENCING OLD TABLE AS live_old FOR EACH STATEMENT EXECUTE FUNCTION live_requests_changed();
