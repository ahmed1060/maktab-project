-- The invitation's link (CLIENT_PORTAL_PLAN.md §5.2, step 6b-1, PR 324): one
-- of a client's people sets their password from it, once, for 72 hours. Only
-- adds: two columns on client accounts, empty for the ones there already.

-- The link's secret, kept only as its SHA-256, so nothing here opens it; and
-- when it stops working.
ALTER TABLE "ClientAccount" ADD COLUMN "inviteTokenHash" TEXT, ADD COLUMN "inviteExpiresAt" TIMESTAMP(3);

-- A link is one account's.
CREATE UNIQUE INDEX "ClientAccount_inviteTokenHash_key" ON "ClientAccount"("inviteTokenHash");

-- What the schema can't say: a link is whole, its secret and its end
-- together; and an account that has set its password holds none.
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_invitation_whole" CHECK (("inviteTokenHash" IS NULL) = ("inviteExpiresAt" IS NULL));
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_active_not_invited" CHECK ("activatedAt" IS NULL OR "inviteTokenHash" IS NULL);
