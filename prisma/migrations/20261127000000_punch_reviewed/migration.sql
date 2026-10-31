-- Flagged check-ins on the one Requests page (UI_PLAN.md §2.3, part 4c): its
-- Done list is in order of when each was decided, as every kind's is, and
-- says why one was rejected; a check-in kept neither, only the audit log
-- did. From now on it keeps both; for those decided already they're found
-- there: the last decision on each, and the reason it gave.
--
-- Only added, and empty until decided: the release before names no such
-- columns, and whatever it decides while this one is on its way is found in
-- the audit log as these were.
ALTER TABLE "AttendancePunch" ADD COLUMN "reviewedAt" TIMESTAMP(3), ADD COLUMN "reviewReason" TEXT;

UPDATE "AttendancePunch" p SET "reviewedAt" = a."createdAt", "reviewReason" = NULLIF(btrim(a.details->>'reason'), '')
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "createdAt", details FROM "AuditLog"
  WHERE "entityType" = 'ATTENDANCE_PUNCH' AND action IN ('ACCEPT_FLAGGED_CHECK_IN', 'REJECT_FLAGGED_CHECK_IN')
  ORDER BY "entityId", "createdAt" DESC
) a
WHERE a."entityId" = p.id;

-- Done reads a company's by when each was decided.
CREATE INDEX "AttendancePunch_companyId_reviewedAt_idx" ON "AttendancePunch"("companyId", "reviewedAt");
