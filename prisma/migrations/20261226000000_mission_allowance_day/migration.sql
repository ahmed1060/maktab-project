-- Each mission day priced (ATTENDANCE_PLAN.md §6.10, Phase 5 part 5, PR 287):
-- the mission allowance for the date, in minor units, kept on the day beside
-- its deduction and its overtime, and worked out again whenever the day is.
--
-- Additive: a day there before it reads as nothing, which is what it was
-- paid, and the code live before this never names the column.
ALTER TABLE "AttendanceDay" ADD COLUMN "missionAllowanceMinor" INTEGER NOT NULL DEFAULT 0;
