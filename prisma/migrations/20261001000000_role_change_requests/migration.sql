-- Role change requests from a company to the Super Admin (ROLES_PLAN.md §6.9).

-- CreateEnum
CREATE TYPE "RoleChangeRequestStatus" AS ENUM ('OPEN', 'DONE', 'DECLINED');

-- CreateTable
CREATE TABLE "RoleChangeRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roleId" TEXT,
    "requestedById" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "RoleChangeRequestStatus" NOT NULL DEFAULT 'OPEN',
    "response" TEXT,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleChangeRequest_status_idx" ON "RoleChangeRequest"("status");

-- CreateIndex
CREATE INDEX "RoleChangeRequest_companyId_idx" ON "RoleChangeRequest"("companyId");

-- AddForeignKey
ALTER TABLE "RoleChangeRequest" ADD CONSTRAINT "RoleChangeRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChangeRequest" ADD CONSTRAINT "RoleChangeRequest_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChangeRequest" ADD CONSTRAINT "RoleChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChangeRequest" ADD CONSTRAINT "RoleChangeRequest_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The role it is about is the asking company's own.
CREATE FUNCTION role_change_request_is_own_role() RETURNS trigger AS $$
BEGIN
    IF NEW."roleId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "Role" WHERE id = NEW."roleId" AND "companyId" = NEW."companyId"
    ) THEN
        RAISE EXCEPTION 'A role change request must be about one of its company''s roles';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER role_change_request_is_own_role
    BEFORE INSERT OR UPDATE OF "roleId", "companyId" ON "RoleChangeRequest"
    FOR EACH ROW EXECUTE FUNCTION role_change_request_is_own_role();
