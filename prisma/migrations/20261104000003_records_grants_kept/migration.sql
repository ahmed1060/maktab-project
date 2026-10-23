-- Records grants kept from the release before them (CLIENTS_PLAN.md §0.3).
--
-- While main's release still runs against this database, its role editor
-- saves a role's grants as a full replacement: it deletes them all, then
-- writes back the ones it knows, and it doesn't know records.*. Saving any
-- role there would take its Records grants away for good, and its template
-- editor does the same to a template's (Codex on #82).
--
-- So a records.* grant stays when a write that isn't this release's would
-- remove it: a delete of the row, from a role that's still there, or an
-- edit of a template's list. This release marks its own writes
-- (set_config('nizmo.release', 'records', true), in RoleService and
-- RoleTemplateService), so it can still take one away. And a grant main
-- writes under its old name, which a role already has under the new one,
-- is the grant kept, not a second one.
--
-- Additive: main's code is unchanged by it except that it can't remove
-- records.* grants, which it can't see. 0b drops all three, with the
-- renaming triggers, once main's release is gone.

CREATE FUNCTION "records_release_writes"() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT coalesce(current_setting('nizmo.release', true), '') = 'records'
$$;

CREATE FUNCTION "RoleGrant_records_kept"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    -- A role being deleted takes its grants with it, as it always has.
    IF OLD."permission" LIKE 'records.%' AND NOT "records_release_writes"()
       AND EXISTS (SELECT 1 FROM "Role" WHERE "id" = OLD."roleId") THEN
        RETURN NULL;
    END IF;
    RETURN OLD;
END
$$;
CREATE TRIGGER "RoleGrant_records_kept" BEFORE DELETE ON "RoleGrant"
FOR EACH ROW EXECUTE FUNCTION "RoleGrant_records_kept"();

-- The renaming trigger of 20261104000000, which now also lets an old-name
-- grant the role already has (kept above) be that grant.
CREATE OR REPLACE FUNCTION "RoleGrant_records_rename"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    renamed TEXT := "records_renamed_permission"(NEW."permission");
BEGIN
    IF TG_OP = 'INSERT' AND renamed <> NEW."permission"
       AND EXISTS (SELECT 1 FROM "RoleGrant" WHERE "roleId" = NEW."roleId" AND "permission" = renamed) THEN
        RETURN NULL;
    END IF;
    NEW."permission" := renamed;
    RETURN NEW;
END
$$;

-- A template's list: the records.* grants it had, put back after the ones
-- written, unless one of those is the same permission (under either name).
-- Named to run before "RoleTemplate_records_rename", which then renames.
CREATE FUNCTION "RoleTemplate_records_kept"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF "records_release_writes"() OR jsonb_typeof(OLD."grants") <> 'array' OR jsonb_typeof(NEW."grants") <> 'array' THEN
        RETURN NEW;
    END IF;
    NEW."grants" := NEW."grants" || COALESCE((
        SELECT jsonb_agg(o.value ORDER BY o.ordinality)
        FROM jsonb_array_elements(OLD."grants") WITH ORDINALITY AS o(value, ordinality)
        WHERE jsonb_typeof(o.value) = 'object' AND o.value->>'permission' LIKE 'records.%'
          AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(NEW."grants") AS n(value)
              WHERE jsonb_typeof(n.value) = 'object'
                AND "records_renamed_permission"(n.value->>'permission') = o.value->>'permission'
          )
    ), '[]'::jsonb);
    RETURN NEW;
END
$$;
CREATE TRIGGER "RoleTemplate_records_kept" BEFORE UPDATE OF "grants" ON "RoleTemplate"
FOR EACH ROW EXECUTE FUNCTION "RoleTemplate_records_kept"();
