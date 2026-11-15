-- The mission allowance across a closed month (ATTENDANCE_PLAN.md §6.10,
-- §12.3, decisions 16 and 25, PR 289): a difference carries what the day's
-- allowance was paid at and what it is now, beside its deduction and
-- overtime.
--
-- Only adds the two columns, with no default: a difference recorded before
-- them, or by the code live while this runs, holds neither, and its paid
-- allowance is read from the day.
ALTER TABLE "AttendanceDiscrepancy" ADD COLUMN "paidAllowanceMinor" INTEGER, ADD COLUMN "nowAllowanceMinor" INTEGER;
