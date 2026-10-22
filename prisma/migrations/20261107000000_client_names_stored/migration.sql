-- Clients' stored names follow the code (CLIENTS_PLAN.md §0.3, PR 0c).
--
-- 0b renamed Vendors to Clients in code but kept the stored names, as 0a's
-- code, live while 0b waited for review, knew only those. Now 0b's code is
-- live, and it reads both names, so the rows can be rewritten under it. It
-- still writes the old ones while 0c waits for review; 0c's code reads both
-- too, and 0d, with the app closed, rewrites any left.

-- 1. The permissions: vendors.* become clients.*, with the same codes in
--    the session token, so nobody's session reloads. A role holds a
--    permission once; one it somehow holds under both names keeps the new.
DELETE FROM "RoleGrant" old
WHERE old."permission" IN ('vendors.view', 'vendors.manage')
  AND EXISTS (
      SELECT 1 FROM "RoleGrant" new
      WHERE new."roleId" = old."roleId" AND new."permission" = 'clients.' || substr(old."permission", length('vendors.') + 1)
  );
UPDATE "RoleGrant" SET "permission" = 'clients.' || substr("permission", length('vendors.') + 1)
WHERE "permission" IN ('vendors.view', 'vendors.manage');

-- A template's grants, a list of { permission, scope }, in the same order.
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

-- 2. A company's own name and icon for Clients, under the module's new key.
UPDATE "Company" SET "moduleLabels" = ("moduleLabels" - 'vendors') || jsonb_build_object('clients', "moduleLabels"->'vendors')
WHERE jsonb_typeof("moduleLabels") = 'object' AND "moduleLabels" ? 'vendors';
UPDATE "Company" SET "moduleIcons" = ("moduleIcons" - 'vendors') || jsonb_build_object('clients', "moduleIcons"->'vendors')
WHERE jsonb_typeof("moduleIcons") = 'object' AND "moduleIcons" ? 'vendors';

-- 3. The old Clients section's own list of businesses, which no release
--    reads (0b deleted its sections). Its column on sections stays until
--    0d: 0b's code, live while this waits for review, selects every column
--    of a section.
ALTER TABLE "ClientSection" DROP CONSTRAINT "ClientSection_clientId_fkey";
DROP TABLE "Client";
