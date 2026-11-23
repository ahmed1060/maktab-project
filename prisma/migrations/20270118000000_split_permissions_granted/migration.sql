-- The grant for companies already there (LATER_CHANGES_PLAN.md §2, PR 385):
-- every permission split by what it does, from PR 365 to PR 383, written in
-- each role and each role template as its parts, at its scope.
--
-- The app has read each one as its parts since its split
-- (lib/permissions/catalogue.ts, splitInto), and saving a role has written
-- the parts since, so nobody gains or loses anything: this writes down what
-- is read. A part a role holds already keeps the wider of the two scopes.
-- The parts bring nothing the old permission didn't
-- (lib/split-permissions-granted.test.ts). Access reviews keep the names they
-- were opened with: they record what was held then. Run again, it finds
-- nothing, and nobody reloads.

-- Each role: the parts in, the old rows out, and the holders of a role
-- changed reload their grants. Postgres runs `given` though nothing reads it,
-- and each role it changes had an old row `gone` takes out.
WITH parts("old", "part") AS (VALUES
    ('lists.manage', 'lists.rename'),
    ('lists.manage', 'lists.merge'),
    ('lists.manage', 'lists.archive'),
    ('obligations.manage', 'obligations.create'),
    ('obligations.manage', 'obligations.edit'),
    ('obligations.manage', 'obligations.approve'),
    ('obligations.manage', 'obligations.delete'),
    ('clients.manage', 'clients.create'),
    ('clients.manage', 'clients.edit'),
    ('clients.manage', 'clients.delete'),
    ('locations.add', 'locations.create'),
    ('locations.manage', 'locations.edit'),
    ('locations.manage', 'locations.archive'),
    ('charges.manage', 'charges.set'),
    ('client_accounts.manage', 'client_accounts.view'),
    ('client_accounts.manage', 'client_accounts.invite'),
    ('client_accounts.manage', 'client_accounts.remove'),
    ('salary_adjustments.manage', 'salary_adjustments.add'),
    ('salary_adjustments.manage', 'salary_adjustments.reverse'),
    ('settlements.manage', 'settlements.view'),
    ('settlements.manage', 'settlements.resend')
),
given AS (
    INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
    SELECT g."roleId", p."part", g."scope" FROM "RoleGrant" g JOIN parts p ON p."old" = g."permission"
    ON CONFLICT ("roleId", "permission") DO UPDATE SET "scope" = GREATEST("RoleGrant"."scope", EXCLUDED."scope")
),
gone AS (
    DELETE FROM "RoleGrant" g USING parts p WHERE g."permission" = p."old"
    RETURNING g."roleId"
)
UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now()
WHERE "id" IN (SELECT "roleId" FROM gone);

-- Each template naming one: the parts instead, where it named it, the wider
-- scope where it names a part too.
WITH parts("old", "part") AS (VALUES
    ('lists.manage', 'lists.rename'),
    ('lists.manage', 'lists.merge'),
    ('lists.manage', 'lists.archive'),
    ('obligations.manage', 'obligations.create'),
    ('obligations.manage', 'obligations.edit'),
    ('obligations.manage', 'obligations.approve'),
    ('obligations.manage', 'obligations.delete'),
    ('clients.manage', 'clients.create'),
    ('clients.manage', 'clients.edit'),
    ('clients.manage', 'clients.delete'),
    ('locations.add', 'locations.create'),
    ('locations.manage', 'locations.edit'),
    ('locations.manage', 'locations.archive'),
    ('charges.manage', 'charges.set'),
    ('client_accounts.manage', 'client_accounts.view'),
    ('client_accounts.manage', 'client_accounts.invite'),
    ('client_accounts.manage', 'client_accounts.remove'),
    ('salary_adjustments.manage', 'salary_adjustments.add'),
    ('salary_adjustments.manage', 'salary_adjustments.reverse'),
    ('settlements.manage', 'settlements.view'),
    ('settlements.manage', 'settlements.resend')
),
named AS (
    SELECT t."id", e->>'permission' AS "permission", (e->>'scope')::"PermissionScope" AS "scope"
    FROM "RoleTemplate" t, jsonb_array_elements(t."grants"::jsonb) AS e
),
changing AS (
    SELECT DISTINCT n."id" FROM named n JOIN parts p ON p."old" = n."permission"
),
rewritten AS (
    SELECT n."id", COALESCE(p."part", n."permission") AS "permission", max(n."scope") AS "scope"
    FROM named n LEFT JOIN parts p ON p."old" = n."permission"
    WHERE n."id" IN (SELECT "id" FROM changing)
    GROUP BY n."id", COALESCE(p."part", n."permission")
)
UPDATE "RoleTemplate" t SET "grants" = (
    SELECT jsonb_agg(jsonb_build_object('permission', r."permission", 'scope', r."scope"::text))
    FROM rewritten r WHERE r."id" = t."id"
), "updatedAt" = now()
WHERE t."id" IN (SELECT "id" FROM changing);
