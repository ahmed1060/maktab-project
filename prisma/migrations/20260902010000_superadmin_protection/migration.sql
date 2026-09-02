/*
  Enhancement: protect founder SuperAdmin accounts from deletion.

  There is currently no delete endpoint for SuperAdmin accounts anywhere
  in the app (no route, no service method, no UI button) — so today these
  accounts are "protected" only by that feature not existing yet. The
  actual reachable way to delete one right now is a direct SQL DELETE,
  which bypasses application code entirely. This migration adds a
  database-level backstop that holds regardless of whether an app-level
  delete feature is ever built, and regardless of who or what issues the
  DELETE.

  isProtected is a per-row flag, not a hardcoded email/ID check in
  application logic — the same category of fragility F-04 already fixed
  once for credentials (a magic identifier baked into code breaks if the
  value ever changes, and doesn't generalize to a future third protected
  account). Which specific rows get isProtected = true is a data decision,
  set via a one-off UPDATE outside this migration — not baked in here,
  since that would mean committing real account emails into permanent git
  history.

  Two independent guards, so protection doesn't depend on the flag alone:
  - A row with isProtected = true can never be deleted.
  - The last remaining SuperAdmin row can never be deleted, flagged or not
    — the whole system loses super-admin access otherwise.
*/

ALTER TABLE "SuperAdmin" ADD COLUMN "isProtected" BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION prevent_protected_superadmin_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."isProtected" THEN
    RAISE EXCEPTION 'Cannot delete a protected SuperAdmin account (id=%)', OLD.id;
  END IF;
  IF (SELECT COUNT(*) FROM "SuperAdmin") <= 1 THEN
    RAISE EXCEPTION 'Cannot delete the last remaining SuperAdmin account';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_protected_superadmin_delete
BEFORE DELETE ON "SuperAdmin"
FOR EACH ROW EXECUTE FUNCTION prevent_protected_superadmin_delete();
