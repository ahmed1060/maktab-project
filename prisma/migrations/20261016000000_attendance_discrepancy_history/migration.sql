-- A day's settled differences are kept (review on #16): each one settled
-- stays as it was resolved, and a later change opens a new one measured
-- from what was settled. At most one is open per person and day.

DROP INDEX "AttendanceDiscrepancy_userId_date_key";
CREATE INDEX "AttendanceDiscrepancy_userId_date_idx" ON "AttendanceDiscrepancy"("userId", "date");
CREATE UNIQUE INDEX "AttendanceDiscrepancy_userId_date_open_key" ON "AttendanceDiscrepancy"("userId", "date") WHERE "resolvedAt" IS NULL;
