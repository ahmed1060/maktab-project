-- The saved lists (CLIENTS_PLAN.md §5.7, §5.10): their permissions for the
-- companies there before them. A new company's roles have had them since
-- the release before, whose role editor knows them; given then, the editor
-- live before it, which didn't, would have dropped them when a role was
-- saved.
--
-- Decided (2026-10-29): every role gets Add list names, as Everyone has it,
-- the companies' own roles too: taking over someone's account needs
-- everything their role holds, so a role that manages Employees would
-- otherwise lose that. The built-in roles get theirs as
-- lib/permissions/built-in.ts has them, so only the built-in Admin manages
-- the lists. A role given either in the role editor since keeps it as it is.
WITH built_in AS (
    INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
    SELECT r."id", g."permission", g."scope"::"PermissionScope"
    FROM "Role" r
    JOIN (VALUES
        ('ADMIN', 'lists.add', 'COMPANY'),
        ('ADMIN', 'lists.manage', 'COMPANY'),
        ('TEAM_LEADER', 'lists.add', 'COMPANY'),
        ('EMPLOYEE', 'lists.add', 'COMPANY')
    ) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
    ON CONFLICT ("roleId", "permission") DO NOTHING
    RETURNING "roleId"
), own AS (
    INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
    SELECT r."id", 'lists.add', 'COMPANY'::"PermissionScope"
    FROM "Role" r
    WHERE r."builtIn" IS NULL
    ON CONFLICT ("roleId", "permission") DO NOTHING
    RETURNING "roleId"
)
-- The holders of a role given one reload their grants.
UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now()
WHERE "id" IN (SELECT "roleId" FROM built_in UNION SELECT "roleId" FROM own);
