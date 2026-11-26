-- Changing when someone's contract started (LATER_CHANGES_PLAN.md §7.2,
-- PR 425): the built-in Admin role's new grant, lib/permissions/built-in.ts
-- row for row, and its holders reload their grants once. Run again, it
-- changes nothing but the version.
INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
SELECT r."id", g."permission", g."scope"::"PermissionScope"
FROM "Role" r
JOIN (VALUES
    ('ADMIN', 'employees.edit_contract_start', 'COMPANY')
) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
ON CONFLICT ("roleId", "permission") DO NOTHING;

UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now() WHERE "builtIn" = 'ADMIN';
