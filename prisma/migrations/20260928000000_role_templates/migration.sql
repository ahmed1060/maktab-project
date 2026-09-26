-- ---------------------------------------------------------------------------
-- Role templates, and the role a company's new accounts start on
-- (ROLES_PLAN.md §5, §6.1, §6.4).
--
-- Additive: a new table and one nullable column. A null default role means
-- the company's built-in Employee role, which every company has, so no
-- existing row needs a value.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "defaultRoleId" TEXT;

-- CreateTable
CREATE TABLE "RoleTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "baseRole" "UserRole" NOT NULL,
    "grants" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoleTemplate_name_key" ON "RoleTemplate"("name");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_defaultRoleId_fkey" FOREIGN KEY ("defaultRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A template, like a role, is never based on the Super Admin (§3.5).
ALTER TABLE "RoleTemplate" ADD CONSTRAINT "RoleTemplate_base_not_super_admin"
    CHECK ("baseRole" <> 'SUPER_ADMIN');

-- A company's default role is one of its own, and not an Admin-based one: it
-- is what every new account gets, and making every hire an Admin by one
-- misconfiguration is not a mistake the database should be willing to store.
CREATE FUNCTION "company_default_role_is_its_own"() RETURNS trigger AS $$
DECLARE
    chosen RECORD;
BEGIN
    IF NEW."defaultRoleId" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT "companyId", "baseRole" INTO chosen FROM "Role" WHERE "id" = NEW."defaultRoleId";
    IF chosen."companyId" IS DISTINCT FROM NEW."id" THEN
        RAISE EXCEPTION 'A company''s default role must be one of its own roles'
            USING ERRCODE = 'check_violation';
    END IF;
    IF chosen."baseRole" = 'ADMIN' THEN
        RAISE EXCEPTION 'A company''s default role cannot be an Admin-based role'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Company_default_role_is_its_own"
    BEFORE INSERT OR UPDATE OF "defaultRoleId" ON "Company"
    FOR EACH ROW EXECUTE FUNCTION "company_default_role_is_its_own"();

-- …and a role that is some company's default keeps a base that allows it.
CREATE FUNCTION "default_role_stays_non_admin"() RETURNS trigger AS $$
BEGIN
    IF NEW."baseRole" = 'ADMIN' AND EXISTS (SELECT 1 FROM "Company" WHERE "defaultRoleId" = NEW."id") THEN
        RAISE EXCEPTION 'A company''s default role cannot become Admin-based'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Role_default_stays_non_admin"
    BEFORE UPDATE OF "baseRole" ON "Role"
    FOR EACH ROW EXECUTE FUNCTION "default_role_stays_non_admin"();
