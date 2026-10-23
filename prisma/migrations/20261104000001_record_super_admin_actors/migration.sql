-- Who added a record, and who last edited it, when that was a Super Admin.
-- A Super Admin has no row in "User", so "createdById" and "lastEditedById"
-- are null for them, as they also are once a user who did it is deleted.
-- These say which of the two it was (CLIENTS_PLAN.md §0.2).
--
-- Additive, with defaults: main's code, which doesn't write them, keeps
-- working against this database while the change waits for review.
ALTER TABLE "ClientNote"
    ADD COLUMN "createdBySuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "lastEditedBySuperAdmin" BOOLEAN NOT NULL DEFAULT false;
