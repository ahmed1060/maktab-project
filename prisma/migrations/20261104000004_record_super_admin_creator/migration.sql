-- Which Super Admin added a record (Codex on #82). Its reminders go to
-- whoever added it, and a Super Admin has no User row: the
-- createdBySuperAdmin flag alone left the reminder nobody to go to.
--
-- Additive: main's code doesn't know the column. A record a Super Admin
-- added before it names nobody, as there's no telling which; production has
-- no records yet.
ALTER TABLE "ClientNote" ADD COLUMN "createdBySuperAdminId" TEXT;
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_createdBySuperAdminId_fkey" FOREIGN KEY ("createdBySuperAdminId") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
