-- Acting roles (ROLES_PLAN.md §6.13): a role held until a date, after which the
-- person returns to the role they had. One role per person still — the acting
-- role replaces theirs for the period.

-- AlterTable
ALTER TABLE "RoleRequest" ADD COLUMN     "actingUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "actingUntil" TIMESTAMP(3),
ADD COLUMN     "returnRoleId" TEXT;

-- CreateIndex
CREATE INDEX "User_actingUntil_idx" ON "User"("actingUntil");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_returnRoleId_fkey" FOREIGN KEY ("returnRoleId") REFERENCES "Role"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- An end date with nowhere to return to, or somewhere to return to with no
-- date, is an acting role nothing will ever end.
ALTER TABLE "User" ADD CONSTRAINT "User_acting_is_whole"
    CHECK (("actingUntil" IS NULL) = ("returnRoleId" IS NULL));

-- The role they return to is their own company's, as the one they hold is.
CREATE FUNCTION user_return_role_is_own() RETURNS trigger AS $$
BEGIN
    IF NEW."returnRoleId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "Role" WHERE id = NEW."returnRoleId" AND "companyId" = NEW."companyId"
    ) THEN
        RAISE EXCEPTION 'The role somebody returns to must be one of their company''s';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_return_role_is_own
    BEFORE INSERT OR UPDATE OF "returnRoleId", "companyId" ON "User"
    FOR EACH ROW EXECUTE FUNCTION user_return_role_is_own();
