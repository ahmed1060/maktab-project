-- The mission allowance paid with salary (ATTENDANCE_PLAN.md §6.10, §12.2,
-- Phase 5 part 5, PR 288): its own category of attendance entry, written at
-- payroll approval beside lateness, early leave, absence and overtime.
--
-- Additive: no entry has the category until an approval by this PR's code
-- writes one, so the code live before it never reads a value it doesn't know.
ALTER TYPE "AttendanceCategory" ADD VALUE 'MISSION_ALLOWANCE';
