-- Whether the company emails its client's people when their tax position is
-- updated (CLIENT_PORTAL_PLAN.md §4.4, step 11a, PR 350): off for every
-- company there is, as it is for a new one. Only adds a column, so a release
-- before it reads the table as it did.
ALTER TABLE "Company" ADD COLUMN "taxUpdateEmails" BOOLEAN NOT NULL DEFAULT false;
