-- A client's tax claims (CLIENT_PORTAL_PLAN.md §3.1, PR 311): what a client
-- owes on the Tax Authority's portal, as the portal's file had it, and the
-- day those figures are from. Only adds: two tables, empty until the first
-- file is uploaded.

-- One open claim, for one client. Its number is text, so its leading zeros
-- stay; its amounts are to the piastre; its days are days.
CREATE TABLE "TaxClaim" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "claimNumber" TEXT NOT NULL,
    "taxType" TEXT,
    "item" TEXT NOT NULL,
    "registrationType" TEXT,
    "originalAmount" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL,
    "remainingAmount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT,
    "status" TEXT,
    "periodStart" DATE,
    "periodEnd" DATE,
    "dueDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxClaim_pkey" PRIMARY KEY ("id")
);

-- When a client's claims are from, and who uploaded them last, by a name
-- kept as it was that day. One row for a client whose file was uploaded.
CREATE TABLE "ClientTaxPosition" (
    "clientId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientTaxPosition_pkey" PRIMARY KEY ("clientId")
);

-- A client has each claim number once. Its claims are read the longest
-- overdue first.
CREATE UNIQUE INDEX "TaxClaim_clientId_claimNumber_key" ON "TaxClaim"("clientId", "claimNumber");
CREATE INDEX "TaxClaim_clientId_dueDate_idx" ON "TaxClaim"("clientId", "dueDate");
CREATE INDEX "TaxClaim_companyId_idx" ON "TaxClaim"("companyId");
CREATE INDEX "ClientTaxPosition_companyId_idx" ON "ClientTaxPosition"("companyId");

-- They go with their client, and their company.
ALTER TABLE "TaxClaim" ADD CONSTRAINT "TaxClaim_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxClaim" ADD CONSTRAINT "TaxClaim_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientTaxPosition" ADD CONSTRAINT "ClientTaxPosition_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientTaxPosition" ADD CONSTRAINT "ClientTaxPosition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientTaxPosition" ADD CONSTRAINT "ClientTaxPosition_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- What the schema can't say. A claim has a number and an item; its amounts
-- aren't negative and add up, with something left to pay, as only open
-- claims are kept (§3.2); and its period's days are in order.
ALTER TABLE "TaxClaim" ADD CONSTRAINT "TaxClaim_named" CHECK (length(btrim("claimNumber")) > 0 AND length(btrim("item")) > 0);
ALTER TABLE "TaxClaim" ADD CONSTRAINT "TaxClaim_amounts" CHECK ("originalAmount" >= 0 AND "paidAmount" >= 0 AND "remainingAmount" > 0 AND "originalAmount" = "paidAmount" + "remainingAmount");
ALTER TABLE "TaxClaim" ADD CONSTRAINT "TaxClaim_period" CHECK ("periodStart" IS NULL OR "periodEnd" IS NULL OR "periodStart" <= "periodEnd");

-- Every table has Row Level Security on (DATABASE_SETUP.md).
ALTER TABLE "TaxClaim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientTaxPosition" ENABLE ROW LEVEL SECURITY;
