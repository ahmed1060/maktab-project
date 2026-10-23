-- Clients' names in the database follow the code (CLIENTS_PLAN.md §0.3,
-- PR 0d). Renaming a table or column breaks the release before, which
-- names the old ones, so this runs with the app closed for maintenance:
-- this PR's last commit, pushed once maintenance mode is on.

-- 1. Any vendors.* name, or a company's old key for Clients, that 0b's code
--    wrote while 0c waited for review: rewritten as 0c rewrote the rest. The
--    code stops reading the old names with this.
DELETE FROM "RoleGrant" old
WHERE old."permission" IN ('vendors.view', 'vendors.manage')
  AND EXISTS (
      SELECT 1 FROM "RoleGrant" new
      WHERE new."roleId" = old."roleId" AND new."permission" = 'clients.' || substr(old."permission", length('vendors.') + 1)
  );
UPDATE "RoleGrant" SET "permission" = 'clients.' || substr("permission", length('vendors.') + 1)
WHERE "permission" IN ('vendors.view', 'vendors.manage');

UPDATE "RoleTemplate" t SET "grants" = (
    SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(g.value) = 'object' AND g.value->>'permission' IN ('vendors.view', 'vendors.manage')
            THEN jsonb_set(g.value, '{permission}', to_jsonb('clients.' || substr(g.value->>'permission', length('vendors.') + 1)))
            ELSE g.value
        END
        ORDER BY g.ordinality
    )
    FROM jsonb_array_elements(t."grants") WITH ORDINALITY AS g(value, ordinality)
)
WHERE jsonb_typeof(t."grants") = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(t."grants") g WHERE g->>'permission' IN ('vendors.view', 'vendors.manage'));

UPDATE "Company" SET "moduleLabels" = ("moduleLabels" - 'vendors') || jsonb_build_object('clients', "moduleLabels"->'vendors')
WHERE jsonb_typeof("moduleLabels") = 'object' AND "moduleLabels" ? 'vendors';
UPDATE "Company" SET "moduleIcons" = ("moduleIcons" - 'vendors') || jsonb_build_object('clients', "moduleIcons"->'vendors')
WHERE jsonb_typeof("moduleIcons") = 'object' AND "moduleIcons" ? 'vendors';

-- 2. The old Clients section's column on sections, whose table 0c dropped,
--    with its unique index and the check that a section has one owner:
--    every section now belongs to a client.
ALTER TABLE "ClientSection" DROP COLUMN "clientId";

-- 3. Vendors are Clients.
ALTER TABLE "Vendor" RENAME TO "Client";
ALTER TABLE "Client" RENAME CONSTRAINT "Vendor_pkey" TO "Client_pkey";
ALTER TABLE "Client" RENAME CONSTRAINT "Vendor_companyId_fkey" TO "Client_companyId_fkey";
ALTER TABLE "Client" RENAME CONSTRAINT "Vendor_createdById_fkey" TO "Client_createdById_fkey";
ALTER INDEX "Vendor_companyId_idx" RENAME TO "Client_companyId_idx";
ALTER INDEX "Vendor_name_companyId_key" RENAME TO "Client_name_companyId_key";

-- 4. A section's client, which every section has.
ALTER TABLE "ClientSection" RENAME COLUMN "vendorId" TO "clientId";
ALTER TABLE "ClientSection" ALTER COLUMN "clientId" SET NOT NULL;
ALTER TABLE "ClientSection" RENAME CONSTRAINT "ClientSection_vendorId_fkey" TO "ClientSection_clientId_fkey";
ALTER INDEX "ClientSection_vendorId_title_key" RENAME TO "ClientSection_clientId_title_key";

-- 5. A task's client.
ALTER TABLE "Task" RENAME COLUMN "vendorId" TO "clientId";
ALTER TABLE "Task" RENAME CONSTRAINT "Task_vendorId_fkey" TO "Task_clientId_fkey";
ALTER INDEX "Task_vendorId_idx" RENAME TO "Task_clientId_idx";
