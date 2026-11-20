-- A client's responsible accountant (CLIENT_PORTAL_PLAN.md §7, step 9b,
-- PR 343): one of the client's company's people, whom the client's people
-- write to on WhatsApp, or none. Only adds: no client has one until whoever
-- may manage clients picks one.
--
-- Someone deleted outright is no one's. Whose contract ends stays picked,
-- and the client's page says the client's people can't write to them until
-- another is (lib/client-accountant.ts).
ALTER TABLE "Client" ADD COLUMN "responsibleAccountantId" TEXT;

ALTER TABLE "Client" ADD CONSTRAINT "Client_responsibleAccountantId_fkey" FOREIGN KEY ("responsibleAccountantId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The clients a person answers for, which their profile names.
CREATE INDEX "Client_responsibleAccountantId_idx" ON "Client"("responsibleAccountantId");
