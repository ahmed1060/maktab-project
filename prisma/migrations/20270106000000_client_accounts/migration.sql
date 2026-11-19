-- Client accounts (CLIENT_PORTAL_PLAN.md §5.1, PR 322): the people of a
-- company's client who sign in to the client portal. Never the company's
-- own people: a table of their own. Only adds: the table, empty until a
-- client's first person is added, and the rule that keeps an email to one
-- account across Nizmo.

-- One of a client's people. Invited until a password is set, active after.
CREATE TABLE "ClientAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "lastSignInAt" TIMESTAMP(3),
    "addedById" TEXT,
    "addedByName" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAccount_pkey" PRIMARY KEY ("id")
);

-- An email is one client account's. A client's people are read together.
CREATE UNIQUE INDEX "ClientAccount_email_key" ON "ClientAccount"("email");
CREATE INDEX "ClientAccount_clientId_idx" ON "ClientAccount"("clientId");
CREATE INDEX "ClientAccount_companyId_idx" ON "ClientAccount"("companyId");

-- It goes with its client, and its company. Whoever added it is kept by
-- name too, as they may leave.
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- What the schema can't say. An account has a name; its email is kept
-- trimmed and in small letters, so two that differ only in capitals are
-- one; and it's active exactly when it has a password.
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_named" CHECK (length(btrim("name")) > 0);
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_email_kept" CHECK ("email" = lower(btrim("email")) AND position('@' in "email") > 1);
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_active_with_password" CHECK (("password" IS NULL) = ("activatedAt" IS NULL));

-- One email, one account, across the three tables that hold them, so
-- signing in finds one account (§5.1). Each table's own index keeps an
-- email to one row of its own; a client account and one of a company's
-- people given the same one at the same moment would both pass a check in
-- code and both be saved.
--
-- Whoever saves an email holds a lock on it, capitals aside, until their
-- save is done, and then the other tables are looked in, as usernames are
-- (20261201000000_username_across_accounts). The second of two saves at
-- once waits for the first, then sees it and is refused as a unique clash,
-- which is answered as an email in use. The email isn't in the message, so
-- it isn't written into the database's log.
--
-- A person and a Super Admin with one email aren't looked for here: those
-- two tables are as they were.
CREATE FUNCTION "email_once_across_accounts"() RETURNS trigger AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('email:' || lower(NEW.email)));
    IF TG_TABLE_NAME = 'ClientAccount' THEN
        IF EXISTS (SELECT 1 FROM "User" WHERE lower(email) = lower(NEW.email))
           OR EXISTS (SELECT 1 FROM "SuperAdmin" WHERE lower(email) = lower(NEW.email)) THEN
            RAISE EXCEPTION 'Somebody has that email already'
                USING ERRCODE = 'unique_violation', CONSTRAINT = 'email_once_across_accounts';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM "ClientAccount" WHERE email = lower(NEW.email)) THEN
        RAISE EXCEPTION 'A client account has that email already'
            USING ERRCODE = 'unique_violation', CONSTRAINT = 'email_once_across_accounts';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ClientAccount_email_once" BEFORE INSERT OR UPDATE OF email ON "ClientAccount"
    FOR EACH ROW EXECUTE FUNCTION "email_once_across_accounts"();
CREATE TRIGGER "User_email_once" BEFORE INSERT OR UPDATE OF email ON "User"
    FOR EACH ROW EXECUTE FUNCTION "email_once_across_accounts"();
CREATE TRIGGER "SuperAdmin_email_once" BEFORE INSERT OR UPDATE OF email ON "SuperAdmin"
    FOR EACH ROW EXECUTE FUNCTION "email_once_across_accounts"();

-- Every table has Row Level Security on (DATABASE_SETUP.md).
ALTER TABLE "ClientAccount" ENABLE ROW LEVEL SECURITY;
