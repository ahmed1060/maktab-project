/*
  F-12: Task.attachments, Task.comments, Task.memberCosts,
  Task.memberPaymentStatus, and AuditLog.details move from String (JSON
  serialized into text, unindexable and unvalidated by Postgres) to Jsonb.

  A plain `::jsonb` cast aborts the whole migration if even one row holds
  text that isn't valid JSON. The app already knows such rows exist —
  maintenance.service.ts's cleanupOrphanedAssets wraps
  JSON.parse(task.attachments) in a try/catch and logs "Skipping malformed
  JSON" — so this uses a temporary cast function that returns NULL for a
  row that fails to parse instead of failing the migration. NULL is safe
  here: every read site already treats an empty/absent value as "no
  attachments" / "no comments" / "{}" (see task.service.ts's
  `field ? JSON.parse(field) : fallback` pattern), which is the same
  practical outcome malformed rows already got before this migration
  (silently unusable — cleanupOrphanedAssets would already have been
  deleting the referenced assets).
*/

CREATE OR REPLACE FUNCTION _f12_safe_to_jsonb(input TEXT) RETURNS JSONB AS $$
BEGIN
    IF input IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN input::jsonb;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- AlterTable
ALTER TABLE "Task"
    ALTER COLUMN "attachments" TYPE JSONB USING _f12_safe_to_jsonb("attachments"),
    ALTER COLUMN "comments" TYPE JSONB USING _f12_safe_to_jsonb("comments"),
    ALTER COLUMN "memberCosts" TYPE JSONB USING _f12_safe_to_jsonb("memberCosts"),
    ALTER COLUMN "memberPaymentStatus" TYPE JSONB USING _f12_safe_to_jsonb("memberPaymentStatus");

-- AlterTable
ALTER TABLE "AuditLog"
    ALTER COLUMN "details" TYPE JSONB USING _f12_safe_to_jsonb("details");

DROP FUNCTION _f12_safe_to_jsonb(TEXT);
