-- The places tasks happen at (CLIENTS_PLAN.md §2.9): the built-in roles'
-- new grants, lib/permissions/built-in.ts row for row, for the companies
-- there before them. A new company's roles have had them since the release
-- before, whose role editor knows them; given then, the editor live before
-- it, which didn't, would have dropped them when a role was saved.
INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
SELECT r."id", g."permission", g."scope"::"PermissionScope"
FROM "Role" r
JOIN (VALUES
    ('ADMIN', 'locations.view', 'COMPANY'),
    ('ADMIN', 'locations.add', 'COMPANY'),
    ('ADMIN', 'locations.manage', 'COMPANY'),
    ('TEAM_LEADER', 'locations.view', 'COMPANY'),
    ('TEAM_LEADER', 'locations.add', 'COMPANY')
) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
ON CONFLICT ("roleId", "permission") DO NOTHING;

-- Their holders reload their grants.
UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now() WHERE "builtIn" IN ('ADMIN', 'TEAM_LEADER');
