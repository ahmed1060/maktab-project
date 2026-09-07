-- Vendors feature: a company's own list of vendors (name, owner, mobile,
-- location), selectable from the task-creation flow instead of typing a
-- location by hand. vendorsLabel lets a Super Admin rename the tab per
-- company; null falls back to the default translated "Vendors" label.
ALTER TABLE "Company" ADD COLUMN "vendorsLabel" TEXT;

-- Formal link back from a task to the vendor its location was copied from
-- (the copied location text itself lives in Task.location, unaffected by
-- this column or by the vendor being deleted later).
ALTER TABLE "Task" ADD COLUMN "vendorId" TEXT;

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "locationLink" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vendor_companyId_idx" ON "Vendor"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_name_companyId_key" ON "Vendor"("name", "companyId");

-- CreateIndex
CREATE INDEX "Task_vendorId_idx" ON "Task"("vendorId");

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Vendor rows are created/managed exclusively through the app's own API
-- (Admin/Super Admin only, company-scoped) — no anon/authenticated Postgres
-- role should ever read or write this table directly. Matches every other
-- table in this database (see 20260906010000_enable_rls_default_deny):
-- RLS on with zero permissive policies, Prisma's direct-connection role
-- (which bypasses RLS entirely) is what the app actually uses.
ALTER TABLE "Vendor" ENABLE ROW LEVEL SECURITY;
