-- Client charges (CLIENTS_PLAN.md §6.6, §6.8): their permissions for the
-- companies there before them, lib/permissions/built-in.ts row for row. A
-- new company's roles have had them since the release before (6b), whose
-- role editor knows them; given then, the editor live before it, which
-- didn't, would have dropped them when a role was saved.
--
-- The built-in roles only, as for locations (§2.9): charges aren't
-- Everyone's, so a company's own roles are given them in the role editor.
-- A role given one there since keeps it as it is.
WITH given AS (
    INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
    SELECT r."id", g."permission", g."scope"::"PermissionScope"
    FROM "Role" r
    JOIN (VALUES
        ('ADMIN', 'charges.view', 'COMPANY'),
        ('ADMIN', 'charges.manage', 'COMPANY'),
        ('ADMIN', 'charges.collect', 'COMPANY'),
        ('TEAM_LEADER', 'charges.view', 'TEAM')
    ) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
    ON CONFLICT ("roleId", "permission") DO NOTHING
    RETURNING "roleId"
)
-- The holders of a role given one reload their grants.
UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now()
WHERE "id" IN (SELECT "roleId" FROM given);
