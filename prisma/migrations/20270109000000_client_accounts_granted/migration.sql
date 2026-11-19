-- Manage who signs in for a client (CLIENT_PORTAL_PLAN.md §9, §12 step 6d,
-- PR 330): its permission for the companies there before it,
-- lib/permissions/built-in.ts row for row. A new company's Admin role has
-- had it since PR 322, whose role editor knows it; given then, the editor
-- live before it, which didn't, would have dropped it when a role was saved.
--
-- The built-in Admin only, as for the tax position (PR 312, PR 317): a
-- company's own roles are given it in the role editor. An Admin role holding
-- it already keeps it as it is. What it brings with it, clients.view, every
-- built-in Admin role holds, and that role's grants aren't changed in the
-- role editor. It opens nothing by itself: People who can sign in is there
-- where the company's package has the client portal (§2), and adding or
-- removing one of a client's people still asks for the step-up confirmation
-- (ROLES_PLAN.md §6.15).
WITH given AS (
    INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
    SELECT r."id", g."permission", g."scope"::"PermissionScope"
    FROM "Role" r
    JOIN (VALUES
        ('ADMIN', 'client_accounts.manage', 'COMPANY')
    ) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
    ON CONFLICT ("roleId", "permission") DO NOTHING
    RETURNING "roleId"
)
-- The holders of a role given it reload their grants.
UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now()
WHERE "id" IN (SELECT "roleId" FROM given);
