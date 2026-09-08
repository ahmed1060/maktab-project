-- Obligation never captured who created it. Every row that predates this
-- migration will have createdById = NULL for that reason alone, not
-- because a Super Admin made it — the app's display logic (see
-- ObligationDetailPage) accounts for that with a rollout-cutoff check,
-- rather than assuming NULL always means Super Admin the way it safely can
-- for Task.createdBy/Vendor.createdById (which have carried this exact
-- meaning since those features shipped).
ALTER TABLE "Obligation" ADD COLUMN "createdById" TEXT;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
