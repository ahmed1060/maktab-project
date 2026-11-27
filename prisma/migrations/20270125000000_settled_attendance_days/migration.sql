-- The days a final settlement counted (LATER_CHANGES_PLAN.md §7.10, Codex review on PR 430): a leaver's
-- attendance after their leaving month's payroll closed, up to their last working day. Marked with the
-- settlement, they're frozen with it, as lockedByPayrollRunId freezes a payroll's. Additive: a new
-- column, empty for every day there is.
ALTER TABLE "AttendanceDay" ADD COLUMN "lockedBySettlementId" TEXT;
