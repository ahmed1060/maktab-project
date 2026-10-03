-- Attendance entries and open discrepancies are per company (review on
-- #16): a person moved between companies can have payroll from both in
-- one month, and one company's approval must not take over the other's.

DROP INDEX "AttendancePayrollEntry_userId_year_month_category_key";
CREATE UNIQUE INDEX "AttendancePayrollEntry_companyId_userId_year_month_category_key" ON "AttendancePayrollEntry"("companyId", "userId", "year", "month", "category");

DROP INDEX "AttendanceDiscrepancy_userId_date_open_key";
CREATE UNIQUE INDEX "AttendanceDiscrepancy_companyId_userId_date_open_key" ON "AttendanceDiscrepancy"("companyId", "userId", "date") WHERE "resolvedAt" IS NULL;
