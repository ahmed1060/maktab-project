-- Saving the tax portal's file (CLIENT_PORTAL_PLAN.md §4.1, §12 step 3b,
-- PR 315): what a client's tax position keeps for its next upload. Only
-- adds: two columns, each with a value for the rows there already.

-- The company the client's last file named, as the file wrote it. The next
-- file's is matched to it, so one client's file isn't saved for another.
-- Nothing until a file that names one is saved.
ALTER TABLE "ClientTaxPosition" ADD COLUMN "fileCompany" TEXT;

-- How many files have been uploaded for the client. A save says how many
-- there were when its check screen read the claims, and is refused where
-- another was saved since. A row there already is one file's.
ALTER TABLE "ClientTaxPosition" ADD COLUMN "uploads" INTEGER NOT NULL DEFAULT 1;
