-- The payroll tables, and the three company settings they read.
--
-- Additive throughout. Every new column has a default, so existing rows are
-- correct the moment the migration lands and nothing has to be backfilled.

-- Company policy. payrollDay is the one that matters: it decides which side of
-- payday a leaver falls on, and therefore whether their settlement pays them or
-- bills them. 25 matches what P5's preview assumed while this column did not
-- exist, so no existing behaviour changes on the day it arrives.
ALTER TABLE "Company" ADD COLUMN "payrollDay" INTEGER NOT NULL DEFAULT 25;
-- Off by default. A default of true would publish pay records to every employee
-- of every existing company on the deploy that adds the column.
ALTER TABLE "Company" ADD COLUMN "payslipsVisible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo';
ALTER TABLE "SystemSettings" ADD COLUMN "defaultTimezone" TEXT NOT NULL DEFAULT 'Africa/Cairo';

CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');
CREATE TYPE "PayslipLineKind" AS ENUM ('EARNING', 'DEDUCTION');
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'WAIVED');
CREATE TYPE "DebtStatus" AS ENUM ('OUTSTANDING', 'SETTLED', 'WAIVED');

CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    -- Copied from Company, not read back through it. Changing the payroll day
    -- must not rewrite what a settlement already closed was measured against.
    "payrollDay" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- One run per company per month. Without it, two people can approve different
-- figures for the same payroll and both are stored.
CREATE UNIQUE INDEX "PayrollRun_companyId_month_year_key" ON "PayrollRun"("companyId", "month", "year");
CREATE INDEX "PayrollRun_companyId_year_month_idx" ON "PayrollRun"("companyId", "year", "month");
CREATE INDEX "PayrollRun_status_idx" ON "PayrollRun"("status");

CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "earningsAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductionsAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "carriedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "daysPaid" INTEGER NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Payslip_payrollRunId_userId_key" ON "Payslip"("payrollRunId", "userId");
CREATE INDEX "Payslip_userId_idx" ON "Payslip"("userId");
-- A bulk issue resumes from here rather than restarting.
CREATE INDEX "Payslip_emailedAt_idx" ON "Payslip"("emailedAt");

CREATE TABLE "PayslipLine" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "kind" "PayslipLineKind" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PayslipLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayslipLine_payslipId_idx" ON "PayslipLine"("payslipId");
CREATE INDEX "PayslipLine_source_sourceId_idx" ON "PayslipLine"("source", "sourceId");

CREATE TABLE "FinalSettlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lastWorkingDay" TIMESTAMP(3) NOT NULL,
    "earnedAmount" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    -- Signed, deliberately. Positive: the company owes. Negative: the person
    -- does. An unsigned amount beside a direction flag allows a state where the
    -- two disagree, and the one thing a settlement must never be is ambiguous
    -- about which way it points.
    "netAmount" DECIMAL(12,2) NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "payrollRunId" TEXT,
    "reason" TEXT,
    "emailedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FinalSettlement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FinalSettlement_companyId_status_idx" ON "FinalSettlement"("companyId", "status");
CREATE INDEX "FinalSettlement_userId_idx" ON "FinalSettlement"("userId");
CREATE INDEX "FinalSettlement_dueDate_idx" ON "FinalSettlement"("dueDate");

CREATE TABLE "Debt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" "DebtStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Debt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Debt_companyId_status_dueDate_idx" ON "Debt"("companyId", "status", "dueDate");
CREATE INDEX "Debt_userId_idx" ON "Debt"("userId");
CREATE INDEX "Debt_source_sourceId_idx" ON "Debt"("source", "sourceId");

ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payrollRunId_fkey"
    FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_payslipId_fkey"
    FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinalSettlement" ADD CONSTRAINT "FinalSettlement_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinalSettlement" ADD CONSTRAINT "FinalSettlement_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SetNull, not Cascade: deleting a payroll run must not delete the settlements
-- it happened to carry. The debt or the entitlement outlives the run.
ALTER TABLE "FinalSettlement" ADD CONSTRAINT "FinalSettlement_payrollRunId_fkey"
    FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
