-- A client with tasks or records is archived instead of deleted
-- (CLIENTS_PLAN.md §4.3). The release before never sets it, and lists every
-- client as it did.
ALTER TABLE "Client" ADD COLUMN "archivedAt" TIMESTAMP(3);
