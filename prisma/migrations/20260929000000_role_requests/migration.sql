-- Role assignment requests (ROLES_PLAN.md §6.12): somebody who may only ask
-- for a role — typically HR — asks, and somebody who may assign decides.


-- CreateEnum
CREATE TYPE "RoleRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RoleRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "note" TEXT,
    "status" "RoleRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleRequest_companyId_status_idx" ON "RoleRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "RoleRequest_userId_idx" ON "RoleRequest"("userId");

-- AddForeignKey
ALTER TABLE "RoleRequest" ADD CONSTRAINT "RoleRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleRequest" ADD CONSTRAINT "RoleRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleRequest" ADD CONSTRAINT "RoleRequest_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleRequest" ADD CONSTRAINT "RoleRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleRequest" ADD CONSTRAINT "RoleRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A person has at most one request waiting: two would race each other, and
-- whoever decided second would silently undo the first.
CREATE UNIQUE INDEX "RoleRequest_one_pending_per_user" ON "RoleRequest"("userId") WHERE "status" = 'PENDING';

-- The role asked for, and the person it is for, are both the request's
-- company's — as for an assignment (the roles migration). Checked here too, so
-- a request cannot be written that no decision could ever apply.
CREATE FUNCTION role_request_is_one_company() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "Role" WHERE id = NEW."roleId" AND "companyId" = NEW."companyId") THEN
        RAISE EXCEPTION 'A role request must be for one of its company''s roles';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "User" WHERE id = NEW."userId" AND "companyId" = NEW."companyId") THEN
        RAISE EXCEPTION 'A role request must be for somebody in its company';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER role_request_is_one_company
    BEFORE INSERT OR UPDATE OF "companyId", "roleId", "userId" ON "RoleRequest"
    FOR EACH ROW EXECUTE FUNCTION role_request_is_one_company();
