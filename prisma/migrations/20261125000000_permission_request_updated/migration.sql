-- Permission hours on the one Requests page (UI_PLAN.md §2.3, part 3a): its
-- Done list is in order of when each was done, as every kind's is, and a
-- permission request kept no such time. From now on it does; for those
-- already there it's worked out: when it was withdrawn, as the audit log
-- has it, or decided, whichever came last, or else when it was asked.
--
-- Only added, with a default: the release before names no such column, and
-- whatever it asks for or changes while this one is on its way still has one.
ALTER TABLE "PermissionRequest" ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "PermissionRequest" p SET "updatedAt" = COALESCE(
  -- GREATEST passes over a null: one withdrawn before anyone decided it.
  GREATEST(p."reviewedAt", (
    SELECT max(a."createdAt") FROM "AuditLog" a
    WHERE a."entityType" = 'PERMISSION_REQUEST' AND a."entityId" = p.id AND a.action = 'CANCEL_ATTENDANCE_PERMISSION'
  )),
  p."createdAt"
);

ALTER TABLE "PermissionRequest"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" SET NOT NULL;
