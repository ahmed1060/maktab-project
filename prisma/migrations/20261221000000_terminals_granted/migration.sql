-- Set up fingerprint terminals (ATTENDANCE_PLAN.md §17.10, Phase 4 part 2,
-- PR 278): its permission for the companies there before it,
-- lib/permissions/built-in.ts row for row. A new company's Admin role has
-- had it since PR 277, whose role editor knows it; given then, the editor
-- live before it, which didn't, would have dropped it when a role was saved.
--
-- The built-in Admin only, as for cash advances (CLIENTS_PLAN.md §7.8): a
-- company's own roles are given it in the role editor. An Admin role holding
-- it already keeps it as it is. It opens nothing until the Super Admin lets
-- the company set its own terminals up (Company.terminalsSetupByCompany).
WITH given AS (
    INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
    SELECT r."id", g."permission", g."scope"::"PermissionScope"
    FROM "Role" r
    JOIN (VALUES
        ('ADMIN', 'attendance.manage_terminals', 'COMPANY')
    ) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
    ON CONFLICT ("roleId", "permission") DO NOTHING
    RETURNING "roleId"
)
-- The holders of a role given it reload their grants.
UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now()
WHERE "id" IN (SELECT "roleId" FROM given);
