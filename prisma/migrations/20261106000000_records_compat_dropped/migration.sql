-- Vendors become Clients in code (CLIENTS_PLAN.md §0.1, PR 0b). The
-- database keeps its own names for now (§0.3): this takes away only what 0a
-- added for the release before it, which no longer runs.
--
-- Every build migrates the one shared database, so production runs 0a's
-- code against this while 0b waits for review. 0a's code needs none of it:
-- it writes records.* itself, and the mark it puts on its own role and
-- template writes (set_config('nizmo.release', ...)) is a setting nothing
-- reads once the triggers below are gone.

-- 1. The triggers that renamed clients.* to records.* on the way in, and
--    kept Records grants from editors that didn't know them. "clients" names
--    the businesses from now on (stored as vendors.* until 0c), so a grant
--    by that name must stay as it's written.
DROP TRIGGER "RoleGrant_records_rename" ON "RoleGrant";
DROP TRIGGER "RoleGrant_records_kept" ON "RoleGrant";
DROP TRIGGER "RoleTemplate_records_rename" ON "RoleTemplate";
DROP TRIGGER "RoleTemplate_records_kept" ON "RoleTemplate";
DROP TRIGGER "Company_records_rename" ON "Company";

DROP FUNCTION "RoleGrant_records_rename"();
DROP FUNCTION "RoleGrant_records_kept"();
DROP FUNCTION "RoleTemplate_records_rename"();
DROP FUNCTION "RoleTemplate_records_kept"();
DROP FUNCTION "Company_records_rename"();
DROP FUNCTION "records_release_writes"();
DROP FUNCTION "records_renamed_permission"(TEXT);
DROP FUNCTION "records_renamed_grants"(JSONB);
DROP FUNCTION "records_renamed_modules"(JSONB);

-- 2. The old Clients section's own sections, with their records. No release
--    reads them, and production has none. Their files, if any, stay in
--    storage. The old table and its column stay until 0c: 0a's code still
--    selects every column of a section.
DELETE FROM "ClientSection" WHERE "vendorId" IS NULL;
