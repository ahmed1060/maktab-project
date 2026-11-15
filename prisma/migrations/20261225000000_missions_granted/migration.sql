-- Decide missions (ATTENDANCE_PLAN.md §6.10, Phase 5 part 4, PR 284): its
-- permission for the companies there before it, lib/permissions/built-in.ts
-- row for row. A new company's Admin role has had it since PR 283, whose role
-- editor knows it; given then, the editor live before it, which didn't, would
-- have dropped it when a role was saved.
--
-- The built-in Admin only, as for Set up fingerprint terminals (PR 278): a
-- company's own roles are given it in the role editor. An Admin role holding
-- it already keeps it as it is.
WITH given AS (
    INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
    SELECT r."id", g."permission", g."scope"::"PermissionScope"
    FROM "Role" r
    JOIN (VALUES
        ('ADMIN', 'attendance.approve_missions', 'COMPANY')
    ) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
    ON CONFLICT ("roleId", "permission") DO NOTHING
    RETURNING "roleId"
)
-- The holders of a role given it reload their grants.
UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now()
WHERE "id" IN (SELECT "roleId" FROM given);
