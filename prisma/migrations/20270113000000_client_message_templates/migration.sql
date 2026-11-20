-- The messages' templates (CLIENT_PORTAL_PLAN.md §7.1, step 10a, PR 346): the
-- two messages the client's page opens Contact on WhatsApp with, Contact the
-- accountant and Ask about this claim, each in Arabic and English, kept where
-- someone has changed them: Nizmo's own (no company), by the Super Admin, and
-- a company's copy. Only adds: a table, empty until a message is changed
-- (steps 10b and 10c). Until then they're Nizmo's own as written
-- (lib/client-message-template.ts).
CREATE TABLE "ClientMessageTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientMessageTemplate_pkey" PRIMARY KEY ("id")
);

-- Each message once in each language: once for Nizmo, and once for each
-- company. A company's are read by the first.
CREATE UNIQUE INDEX "ClientMessageTemplate_company_kind_language" ON "ClientMessageTemplate"("companyId", "kind", "language") WHERE "companyId" IS NOT NULL;
CREATE UNIQUE INDEX "ClientMessageTemplate_nizmo_kind_language" ON "ClientMessageTemplate"("kind", "language") WHERE "companyId" IS NULL;

-- A company's go with it. Who changed one last is kept by their name too, as
-- a Super Admin is by their name alone: someone deleted outright is no one.
ALTER TABLE "ClientMessageTemplate" ADD CONSTRAINT "ClientMessageTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientMessageTemplate" ADD CONSTRAINT "ClientMessageTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- What the schema can't say: there are two messages and two languages, and a
-- text isn't empty and is up to 1,000 characters. Which fields a text may
-- name is checked before it's saved (messageProblem).
ALTER TABLE "ClientMessageTemplate" ADD CONSTRAINT "ClientMessageTemplate_kind" CHECK ("kind" IN ('contact', 'claim'));
ALTER TABLE "ClientMessageTemplate" ADD CONSTRAINT "ClientMessageTemplate_language" CHECK ("language" IN ('ar', 'en'));
ALTER TABLE "ClientMessageTemplate" ADD CONSTRAINT "ClientMessageTemplate_text" CHECK (length(btrim("text", E' \t\r\n')) > 0 AND char_length("text") <= 1000);

-- Every table has Row Level Security on (DATABASE_SETUP.md).
ALTER TABLE "ClientMessageTemplate" ENABLE ROW LEVEL SECURITY;
