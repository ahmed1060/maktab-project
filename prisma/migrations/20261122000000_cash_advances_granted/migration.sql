-- Cash advances (CLIENTS_PLAN.md §7.7, §7.8): their permissions for the
-- companies there before them, lib/permissions/built-in.ts row for row. A
-- new company's roles have had them since 7a, whose role editor knows them;
-- given then, the editor live before it, which didn't, would have dropped
-- them when a role was saved.
--
-- The built-in roles only, as for charges (§6.8): cash advances aren't
-- Everyone's, so a company's own roles are given them in the role editor.
-- A role given one there since keeps it as it is. They open nothing until
-- the Super Admin allows a company cash advances (§7.6).
WITH given AS (
    INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
    SELECT r."id", g."permission", g."scope"::"PermissionScope"
    FROM "Role" r
    JOIN (VALUES
        ('ADMIN', 'cash_advances.view', 'COMPANY'),
        ('ADMIN', 'cash_advances.give', 'COMPANY'),
        ('TEAM_LEADER', 'cash_advances.view', 'TEAM')
    ) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
    ON CONFLICT ("roleId", "permission") DO NOTHING
    RETURNING "roleId"
)
-- The holders of a role given one reload their grants.
UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now()
WHERE "id" IN (SELECT "roleId" FROM given);
