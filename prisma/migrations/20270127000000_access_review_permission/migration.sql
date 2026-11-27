-- Answering access reviews, a permission of its own (LATER_CHANGES_PLAN.md
-- §7.15, PR 439; ROLES_PLAN.md §6.14): employees.review_access, where
-- employees.assign_role was. Every role holding Assign roles is given it, at
-- the company's scope, so whoever answered access reviews still does until
-- it's unticked; the built-in Admin role among them. The holders of each role
-- it changes reload their grants once. Run again, it changes nothing.
WITH given AS (
    INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
    SELECT g."roleId", 'employees.review_access', 'COMPANY'::"PermissionScope"
    FROM "RoleGrant" g WHERE g."permission" = 'employees.assign_role'
    ON CONFLICT ("roleId", "permission") DO NOTHING
    RETURNING "roleId"
)
UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now() WHERE "id" IN (SELECT "roleId" FROM given);

-- Each role template naming Assign roles, so a role made from it later answers
-- them too. Once: a template naming it already is left as it is.
UPDATE "RoleTemplate" t
SET "grants" = t."grants"::jsonb || jsonb_build_array(jsonb_build_object('permission', 'employees.review_access', 'scope', 'COMPANY')),
    "updatedAt" = now()
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(t."grants"::jsonb) e WHERE e->>'permission' = 'employees.assign_role')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t."grants"::jsonb) e WHERE e->>'permission' = 'employees.review_access');
