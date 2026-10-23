-- Records move onto clients (CLIENTS_PLAN.md §0.2, PR 0a). Today's Clients
-- section kept, for each of its own businesses, sections of notes. Those are
-- now a client's records: a section belongs to a vendor, which becomes a
-- client in 0b.
--
-- Every build migrates the one shared database, so production runs main's
-- code against this while the PR waits for review (§0.3). Everything here is
-- additive for main's code: the old Clients table and its column stay, and
-- main can still add a section to its own businesses. 0b drops them; by then
-- main runs this PR's code, which never reads them.

-- A section belongs to a vendor now. The old column is kept but no longer
-- required, and exactly one of the two is set.
ALTER TABLE "ClientSection" ADD COLUMN "vendorId" TEXT;
ALTER TABLE "ClientSection" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "ClientSection" ADD CONSTRAINT "ClientSection_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientSection" ADD CONSTRAINT "ClientSection_one_owner" CHECK (("clientId" IS NULL) <> ("vendorId" IS NULL));
CREATE UNIQUE INDEX "ClientSection_vendorId_title_key" ON "ClientSection"("vendorId", "title");

-- A client's records are read by section, and the Records page and the daily
-- reminder look for them by expiry date.
CREATE INDEX "ClientNote_sectionId_idx" ON "ClientNote"("sectionId");
CREATE INDEX "ClientNote_expiryDate_idx" ON "ClientNote"("expiryDate");

-- The permissions follow: clients.* become records.*, keeping their meaning
-- and their codes in the session token (lib/permissions/catalogue.ts). And a
-- company's own name and icon for the old Clients section carry over to
-- Records, which is the same section, on each client's page (lib/modules.ts).
CREATE FUNCTION "records_renamed_permission"(name TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN name IN ('clients.view', 'clients.contribute', 'clients.edit', 'clients.delete')
        THEN 'records.' || substr(name, length('clients.') + 1)
        ELSE name
    END
$$;

-- A template's grants, a list of { permission, scope }, in the same order.
CREATE FUNCTION "records_renamed_grants"(grants JSONB) RETURNS JSONB
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN jsonb_typeof(grants) = 'array' THEN COALESCE((
        SELECT jsonb_agg(
            CASE WHEN jsonb_typeof(g.value) = 'object' AND g.value ? 'permission'
                THEN jsonb_set(g.value, '{permission}', to_jsonb("records_renamed_permission"(g.value->>'permission')))
                ELSE g.value
            END
            ORDER BY g.ordinality
        )
        FROM jsonb_array_elements(grants) WITH ORDINALITY AS g(value, ordinality)
    ), '[]'::jsonb)
    ELSE grants END
$$;

-- A company's names or icons for its modules, keyed by module.
CREATE FUNCTION "records_renamed_modules"(modules JSONB) RETURNS JSONB
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN jsonb_typeof(modules) = 'object' AND modules ? 'clients'
        THEN (modules - 'clients') || jsonb_build_object('records', modules->'clients')
        ELSE modules
    END
$$;

UPDATE "RoleGrant" SET "permission" = "records_renamed_permission"("permission")
WHERE "permission" <> "records_renamed_permission"("permission");

-- Signed-in people pick up their roles' new names within a minute.
UPDATE "Role" SET "version" = "version" + 1
WHERE "id" IN (SELECT "roleId" FROM "RoleGrant" WHERE "permission" LIKE 'records.%');

UPDATE "RoleTemplate" SET "grants" = "records_renamed_grants"("grants")
WHERE "grants" <> "records_renamed_grants"("grants");

UPDATE "Company" SET "moduleLabels" = "records_renamed_modules"("moduleLabels")
WHERE "moduleLabels" ? 'clients';

UPDATE "Company" SET "moduleIcons" = "records_renamed_modules"("moduleIcons")
WHERE "moduleIcons" ? 'clients';

-- Main's code still writes the old names while this waits for review: a
-- company created then gets its built-in roles with clients.*, and its
-- settings screen saves a name for "clients". The database renames them on
-- the way in, so nothing written meanwhile is lost to this PR's code. 0b
-- drops these triggers before "clients" takes its new meaning, the
-- businesses today called vendors (CLIENTS_PLAN.md §0.3).
CREATE FUNCTION "RoleGrant_records_rename"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW."permission" := "records_renamed_permission"(NEW."permission");
    RETURN NEW;
END
$$;
CREATE TRIGGER "RoleGrant_records_rename" BEFORE INSERT OR UPDATE OF "permission" ON "RoleGrant"
FOR EACH ROW EXECUTE FUNCTION "RoleGrant_records_rename"();

CREATE FUNCTION "RoleTemplate_records_rename"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW."grants" := "records_renamed_grants"(NEW."grants");
    RETURN NEW;
END
$$;
CREATE TRIGGER "RoleTemplate_records_rename" BEFORE INSERT OR UPDATE OF "grants" ON "RoleTemplate"
FOR EACH ROW EXECUTE FUNCTION "RoleTemplate_records_rename"();

CREATE FUNCTION "Company_records_rename"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW."moduleLabels" := "records_renamed_modules"(NEW."moduleLabels");
    NEW."moduleIcons" := "records_renamed_modules"(NEW."moduleIcons");
    RETURN NEW;
END
$$;
CREATE TRIGGER "Company_records_rename" BEFORE INSERT OR UPDATE OF "moduleLabels", "moduleIcons" ON "Company"
FOR EACH ROW EXECUTE FUNCTION "Company_records_rename"();
