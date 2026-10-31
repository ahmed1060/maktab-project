-- Ask for leave (UI_PLAN.md §2.3, part 2b): its permission for the companies
-- there before it. A new company's roles have had it since 2a, whose role
-- editor knows it; given then, the editor live before it, which didn't,
-- would have dropped it when a role was saved.
--
-- Decided (2026-10-30): the built-in Employee and Team Leader, who ask for
-- leave today, as lib/permissions/built-in.ts has them, and every one of a
-- company's own roles, whatever its base. Not the built-in Admin, who
-- doesn't ask today either. A role given it in the role editor since keeps
-- it as it is. Only ever one's own leave, so at Own.
WITH built_in AS (
    INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
    SELECT r."id", g."permission", g."scope"::"PermissionScope"
    FROM "Role" r
    JOIN (VALUES
        ('TEAM_LEADER', 'dayoff.request', 'OWN'),
        ('EMPLOYEE', 'dayoff.request', 'OWN')
    ) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
    ON CONFLICT ("roleId", "permission") DO NOTHING
    RETURNING "roleId"
), own AS (
    INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
    SELECT r."id", 'dayoff.request', 'OWN'::"PermissionScope"
    FROM "Role" r
    WHERE r."builtIn" IS NULL
    ON CONFLICT ("roleId", "permission") DO NOTHING
    RETURNING "roleId"
)
-- The holders of a role given it reload their grants.
UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now()
WHERE "id" IN (SELECT "roleId" FROM built_in UNION SELECT "roleId" FROM own);
