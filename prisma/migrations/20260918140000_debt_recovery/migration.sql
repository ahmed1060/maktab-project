-- Debt recovery: collecting what a floored payslip carried.
--
-- Both columns default to today's behaviour, so applying this changes nothing
-- until the code that reads them ships alongside it.
--
-- debtRecoveryPercent is 100 because that is what was asked for: a debt comes
-- out of the next month in full. It exists as a column rather than a constant
-- so that capping it later is a settings change, not a payroll change.
ALTER TABLE "Company" ADD COLUMN "debtRecoveryPercent" INTEGER NOT NULL DEFAULT 100;

-- recoveredAmount is kept beside amount rather than subtracted from it: the
-- original obligation is what somebody disputes, and a column that shrinks
-- cannot answer how much the debt was to begin with.
ALTER TABLE "Debt" ADD COLUMN "recoveredAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
