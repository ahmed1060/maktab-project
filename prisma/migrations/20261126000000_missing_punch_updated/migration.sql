-- Missing punches on the one Requests page (UI_PLAN.md §2.3, part 3b): its
-- Done list is in order of when each was done, as every kind's is, and a
-- report of a missing punch kept no such time. From now on it does; for
-- those already there it's worked out as permission hours' was (PR 130):
-- when it was withdrawn, as the audit log has it, or decided, whichever
-- came last, or else when it was reported.
--
-- Only added, with a default: the release before names no such column, and
-- whatever it reports or changes while this one is on its way still has one.
ALTER TABLE "MissingPunchRequest" ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "MissingPunchRequest" m SET "updatedAt" = COALESCE(
  -- GREATEST passes over a null: one withdrawn before anyone decided it.
  GREATEST(m."reviewedAt", (
    SELECT max(a."createdAt") FROM "AuditLog" a
    WHERE a."entityType" = 'MISSING_PUNCH_REQUEST' AND a."entityId" = m.id AND a.action = 'CANCEL_MISSING_PUNCH'
  )),
  m."createdAt"
);

ALTER TABLE "MissingPunchRequest"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" SET NOT NULL;
