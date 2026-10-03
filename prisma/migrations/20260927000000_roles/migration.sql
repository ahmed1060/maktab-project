-- ---------------------------------------------------------------------------
-- Roles become data (ROLES_PLAN.md §3.1, §5, §7 step 3).
--
-- Until now what each of the four roles may do was a table in code
-- (lib/permissions/built-in.ts). From here it is rows: every company gets an
-- Admin, a Team Leader and an Employee role holding exactly those grants, and
-- every account points at the one matching the role it already has. Nobody's
-- access changes — the grants below are that table, generated from it, and
-- lib/roles-migration.test.ts fails if the two ever disagree.
--
-- Additive until the last step: new tables and one nullable column, filled in,
-- then held consistent by a CHECK and two triggers.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('OWN', 'TEAM', 'COMPANY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "roleId" TEXT;

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "baseRole" "UserRole" NOT NULL,
    "builtIn" "UserRole",
    "version" INTEGER NOT NULL DEFAULT 1,
    "copiedFromTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleGrant" (
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "scope" "PermissionScope" NOT NULL,

    CONSTRAINT "RoleGrant_pkey" PRIMARY KEY ("roleId","permission")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_companyId_name_key" ON "Role"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Role_companyId_builtIn_key" ON "Role"("companyId", "builtIn");

-- CreateIndex
CREATE INDEX "RoleGrant_permission_roleId_idx" ON "RoleGrant"("permission", "roleId");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleGrant" ADD CONSTRAINT "RoleGrant_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- A role never has the Super Admin as its base: the Super Admin is outside
-- the role system (§3.5). And a built-in role is always what it says it is.
-- ---------------------------------------------------------------------------
ALTER TABLE "Role" ADD CONSTRAINT "Role_base_not_super_admin"
    CHECK ("baseRole" <> 'SUPER_ADMIN');
ALTER TABLE "Role" ADD CONSTRAINT "Role_built_in_is_its_base"
    CHECK ("builtIn" IS NULL OR "builtIn" = "baseRole");

-- ---------------------------------------------------------------------------
-- Every company's three built-in roles.
-- ---------------------------------------------------------------------------
INSERT INTO "Role" ("id", "companyId", "name", "baseRole", "builtIn", "version", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."id", b."name", b."role"::"UserRole", b."role"::"UserRole", 1, now(), now()
FROM "Company" c
CROSS JOIN (VALUES
    ('Admin', 'ADMIN'),
    ('Team Leader', 'TEAM_LEADER'),
    ('Employee', 'EMPLOYEE')
) AS b("name", "role");

-- Their grants: lib/permissions/built-in.ts, row for row.
INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
SELECT r."id", g."permission", g."scope"::"PermissionScope"
FROM "Role" r
JOIN (VALUES
    ('ADMIN', 'payroll.view', 'COMPANY'),
    ('ADMIN', 'payroll.prepare', 'COMPANY'),
    ('ADMIN', 'payroll.approve', 'COMPANY'),
    ('ADMIN', 'payroll.issue_payslips', 'COMPANY'),
    ('ADMIN', 'payroll.mark_paid', 'COMPANY'),
    ('ADMIN', 'settlements.manage', 'COMPANY'),
    ('ADMIN', 'debts.view', 'COMPANY'),
    ('ADMIN', 'debts.waive', 'COMPANY'),
    ('ADMIN', 'salary.view', 'COMPANY'),
    ('ADMIN', 'salary_adjustments.manage', 'COMPANY'),
    ('ADMIN', 'dayoff.view', 'COMPANY'),
    ('ADMIN', 'dayoff.approve', 'COMPANY'),
    ('ADMIN', 'dayoff.adjust_credit', 'COMPANY'),
    ('ADMIN', 'employees.view', 'COMPANY'),
    ('ADMIN', 'employees.create', 'COMPANY'),
    ('ADMIN', 'employees.edit', 'COMPANY'),
    ('ADMIN', 'employees.change_status', 'COMPANY'),
    ('ADMIN', 'employees.end_contract', 'COMPANY'),
    ('ADMIN', 'employees.delete', 'COMPANY'),
    ('ADMIN', 'employees.reset_password', 'COMPANY'),
    ('ADMIN', 'employees.assign_team', 'COMPANY'),
    ('ADMIN', 'employees.assign_role', 'COMPANY'),
    ('ADMIN', 'salary.edit', 'COMPANY'),
    ('ADMIN', 'tasks.view', 'COMPANY'),
    ('ADMIN', 'tasks.create', 'COMPANY'),
    ('ADMIN', 'tasks.edit', 'COMPANY'),
    ('ADMIN', 'tasks.transfer', 'COMPANY'),
    ('ADMIN', 'tasks.review', 'COMPANY'),
    ('ADMIN', 'tasks.delete', 'COMPANY'),
    ('ADMIN', 'tasks.pay', 'COMPANY'),
    ('ADMIN', 'tasks.penalize', 'COMPANY'),
    ('ADMIN', 'obligations.view', 'COMPANY'),
    ('ADMIN', 'obligations.manage', 'COMPANY'),
    ('ADMIN', 'requests.view', 'COMPANY'),
    ('ADMIN', 'requests.review', 'COMPANY'),
    ('ADMIN', 'requests.reset_points', 'COMPANY'),
    ('ADMIN', 'profile_requests.review', 'COMPANY'),
    ('ADMIN', 'clients.view', 'COMPANY'),
    ('ADMIN', 'clients.contribute', 'COMPANY'),
    ('ADMIN', 'clients.edit', 'COMPANY'),
    ('ADMIN', 'clients.delete', 'COMPANY'),
    ('ADMIN', 'vendors.view', 'COMPANY'),
    ('ADMIN', 'vendors.manage', 'COMPANY'),
    ('ADMIN', 'costs.view', 'COMPANY'),
    ('TEAM_LEADER', 'employees.view', 'TEAM'),
    ('TEAM_LEADER', 'tasks.view', 'TEAM'),
    ('TEAM_LEADER', 'tasks.create', 'TEAM'),
    ('TEAM_LEADER', 'tasks.edit', 'TEAM'),
    ('TEAM_LEADER', 'tasks.transfer', 'TEAM'),
    ('TEAM_LEADER', 'tasks.review', 'TEAM'),
    ('TEAM_LEADER', 'tasks.delete', 'TEAM'),
    ('TEAM_LEADER', 'tasks.pay', 'TEAM'),
    ('TEAM_LEADER', 'tasks.penalize', 'TEAM'),
    ('TEAM_LEADER', 'obligations.view', 'TEAM'),
    ('TEAM_LEADER', 'obligations.manage', 'TEAM'),
    ('TEAM_LEADER', 'requests.view', 'TEAM'),
    ('TEAM_LEADER', 'requests.review', 'TEAM'),
    ('TEAM_LEADER', 'clients.view', 'COMPANY'),
    ('TEAM_LEADER', 'clients.contribute', 'COMPANY'),
    ('TEAM_LEADER', 'clients.edit', 'COMPANY'),
    ('TEAM_LEADER', 'vendors.view', 'COMPANY'),
    ('EMPLOYEE', 'clients.view', 'COMPANY'),
    ('EMPLOYEE', 'clients.contribute', 'COMPANY')
) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn";

-- Everyone onto the built-in role matching the one they have. A row whose role
-- is SUPER_ADMIN matches none and keeps no role, as it should; so does an
-- account with no company, which no company role can belong to.
UPDATE "User" u
SET "roleId" = r."id"
FROM "Role" r
WHERE r."companyId" = u."companyId" AND r."builtIn" = u."role";

-- ---------------------------------------------------------------------------
-- From here every account in a company has a role.
-- ---------------------------------------------------------------------------
ALTER TABLE "User" ADD CONSTRAINT "User_has_role"
    CHECK ("roleId" IS NOT NULL OR "role" = 'SUPER_ADMIN' OR "companyId" IS NULL);

-- ---------------------------------------------------------------------------
-- User.role is the base role of the role the person holds, and that role is
-- their own company's. RoleAssignmentService writes both together; this is the
-- belt to its braces (§3.1), the same way the founder Super Admin accounts are
-- protected. A trigger rather than a CHECK because it has to read the Role.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "user_role_matches_assigned_role"() RETURNS trigger AS $$
DECLARE
    assigned RECORD;
BEGIN
    IF NEW."roleId" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT "baseRole", "companyId" INTO assigned FROM "Role" WHERE "id" = NEW."roleId";
    IF NEW."role" IS DISTINCT FROM assigned."baseRole" THEN
        RAISE EXCEPTION 'User.role (%) must be the base role (%) of the role assigned', NEW."role", assigned."baseRole"
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."companyId" IS DISTINCT FROM assigned."companyId" THEN
        RAISE EXCEPTION 'A user may only hold a role of their own company'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_role_matches_assigned_role"
    BEFORE INSERT OR UPDATE OF "role", "roleId", "companyId" ON "User"
    FOR EACH ROW EXECUTE FUNCTION "user_role_matches_assigned_role"();

-- A held role's base role and company cannot move under its holders (§4.3):
-- every holder's User.role would then disagree with it, and team scoping,
-- subscription exemption and the rest would follow the stale value.
CREATE FUNCTION "role_base_fixed_while_held"() RETURNS trigger AS $$
BEGIN
    IF (NEW."baseRole" IS DISTINCT FROM OLD."baseRole" OR NEW."companyId" IS DISTINCT FROM OLD."companyId")
       AND EXISTS (SELECT 1 FROM "User" WHERE "roleId" = OLD."id") THEN
        RAISE EXCEPTION 'A role''s base role and company cannot change while anyone holds it'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Role_base_fixed_while_held"
    BEFORE UPDATE OF "baseRole", "companyId" ON "Role"
    FOR EACH ROW EXECUTE FUNCTION "role_base_fixed_while_held"();
