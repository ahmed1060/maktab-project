-- The language each of a client's people is invited in (CLIENT_PORTAL_PLAN.md
-- §5.2, step 6b-2, PR 325): their invitation's email is in it alone, and the
-- page that sets their password opens in it. Only adds: the accounts there
-- already, and any added by code older than this, are Arabic, as Add person
-- starts on it.
ALTER TABLE "ClientAccount" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'ar';

-- The two languages Nizmo speaks.
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_language_known" CHECK ("language" IN ('ar', 'en'));
