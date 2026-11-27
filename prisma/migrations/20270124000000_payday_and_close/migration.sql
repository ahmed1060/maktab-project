-- Payday and the attendance period (LATER_CHANGES_PLAN.md §7.10, PR 430).
-- Additive: each column with a default, so the code before this reads on.

CREATE TYPE "PaydayMove" AS ENUM ('BEFORE', 'AFTER');

-- Payday's new choices, and the day the month's payroll closes (none: the
-- month's last day). Added as today's payday reads: in its own month.
ALTER TABLE "Company"
    ADD COLUMN "paydayLastDay" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "paydayNextMonth" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "paydayMove" "PaydayMove" NOT NULL DEFAULT 'BEFORE',
    ADD COLUMN "payrollCloseDay" INTEGER;

-- Payday comes after the close. Each company whose payday doesn't (every one
-- there is: paid in its own month, closing on its last day) is paid on day 1
-- of the month after, as the owner decided for both on 27 November; its
-- close stays the month's last day.
UPDATE "Company"
    SET "payrollDay" = 1, "paydayLastDay" = false, "paydayNextMonth" = true
    WHERE "paydayNextMonth" = false
      AND ("payrollCloseDay" IS NULL OR ("paydayLastDay" AND "payrollCloseDay" >= 28) OR (NOT "paydayLastDay" AND "payrollDay" <= "payrollCloseDay"));

-- And so for a new company from now on.
ALTER TABLE "Company" ALTER COLUMN "payrollDay" SET DEFAULT 1;
ALTER TABLE "Company" ALTER COLUMN "paydayNextMonth" SET DEFAULT true;

-- What each month's run keeps: its period and its payday, and whether its
-- payday was changed for it.
ALTER TABLE "PayrollRun"
    ADD COLUMN "periodStart" DATE,
    ADD COLUMN "periodEnd" DATE,
    ADD COLUMN "payday" DATE,
    ADD COLUMN "paydayChanged" BOOLEAN NOT NULL DEFAULT false;

-- A month approved before kept the calendar month and was paid on its payroll
-- day in that month: so it stays.
UPDATE "PayrollRun"
    SET "periodStart" = make_date("year", "month", 1),
        "periodEnd" = (make_date("year", "month", 1) + INTERVAL '1 month - 1 day')::date,
        "payday" = make_date("year", "month", "payrollDay")
    WHERE "status" IN ('APPROVED', 'PAID');

-- A leaver's attendance after the leaving month's payroll closed, counted in
-- their final settlement: those days belong to a month they're not paid in.
ALTER TABLE "FinalSettlement" ADD COLUMN "attendanceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
