-- The day a client's people were last sent the update email
-- (CLIENT_PORTAL_PLAN.md §4.4, step 11b, PR 351), the company's day: at most
-- one a day for a client. Only added: none yet for any client, so the next
-- upload with the company's switch on sends one.
ALTER TABLE "ClientTaxPosition" ADD COLUMN "emailedOn" DATE;
