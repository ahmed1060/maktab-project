-- Attendance reaches payroll (ATTENDANCE_PLAN.md §12, Phase 1): from a month
-- the company chooses, as money reconciled inside payroll approval.

-- AlterTable: null keeps every company on the dry run until it chooses a month.
ALTER TABLE "Company" ADD COLUMN "attendancePayrollFrom" DATE;
ALTER TABLE "Company" ADD CONSTRAINT "Company_attendance_payroll_from_first" CHECK ("attendancePayrollFrom" IS NULL OR EXTRACT(DAY FROM "attendancePayrollFrom") = 1);

-- CreateEnum
CREATE TYPE "AttendanceCategory" AS ENUM ('LATENESS', 'EARLY_LEAVE', 'ABSENCE', 'OVERTIME');

-- CreateTable
CREATE TABLE "AttendancePayrollEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "category" "AttendanceCategory" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendancePayrollEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AttendancePayrollEntry_positive" CHECK ("amountMinor" > 0),
    CONSTRAINT "AttendancePayrollEntry_month" CHECK ("month" BETWEEN 1 AND 12)
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePayrollEntry_userId_year_month_category_key" ON "AttendancePayrollEntry"("userId", "year", "month", "category");
CREATE INDEX "AttendancePayrollEntry_companyId_year_month_idx" ON "AttendancePayrollEntry"("companyId", "year", "month");

-- AddForeignKey
ALTER TABLE "AttendancePayrollEntry" ADD CONSTRAINT "AttendancePayrollEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendancePayrollEntry" ADD CONSTRAINT "AttendancePayrollEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendancePayrollEntry" ADD CONSTRAINT "AttendancePayrollEntry_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
