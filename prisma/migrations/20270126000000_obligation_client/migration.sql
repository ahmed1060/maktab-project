-- An obligation's client (LATER_CHANGES_PLAN.md §7.7, 7a): optional, as a
-- task's is, and set to none if the client is deleted. Only adds: no row is
-- changed, and the column starts empty.
ALTER TABLE "Obligation" ADD COLUMN "clientId" TEXT;

CREATE INDEX "Obligation_clientId_idx" ON "Obligation"("clientId");

ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
