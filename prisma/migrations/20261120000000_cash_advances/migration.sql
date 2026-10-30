-- Cash advances (CLIENTS_PLAN.md §7, step 7a): money a company gives an
-- employee up front, to pay task costs from. Every movement is an entry,
-- never edited, and the balance is always their sum (§7.4). Only added: the
-- release before never names the table or the two switches, and a company
-- doesn't use cash advances until the Super Admin allows them (§7.6).
CREATE TYPE "CashAdvanceEntryKind" AS ENUM ('GIVEN', 'SPENT', 'RETURNED', 'CORRECTION');

ALTER TABLE "Company"
  ADD COLUMN "cashAdvancesAllowed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cashAdvancesOn" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "CashAdvanceEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CashAdvanceEntryKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "photoUrl" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "recordedById" TEXT NOT NULL,
    "recordedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashAdvanceEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashAdvanceEntry_photoUrl_key" ON "CashAdvanceEntry"("photoUrl");
CREATE INDEX "CashAdvanceEntry_companyId_userId_idx" ON "CashAdvanceEntry"("companyId", "userId");
CREATE INDEX "CashAdvanceEntry_userId_createdAt_idx" ON "CashAdvanceEntry"("userId", "createdAt");

ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Like every table, reached only through the app (DATABASE_SETUP.md).
ALTER TABLE "CashAdvanceEntry" ENABLE ROW LEVEL SECURITY;

-- Each kind's amount the right way round (§7.4): an advance given adds to
-- the balance, one returned takes from it, and a correction is never of
-- nothing. Spent entries come with 7b, which sets their rule.
ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_amount_check" CHECK (
  ("kind" <> 'GIVEN' OR "amount" > 0) AND ("kind" <> 'RETURNED' OR "amount" < 0) AND ("kind" <> 'CORRECTION' OR "amount" <> 0)
);
-- Only an advance given is confirmed, or has a photo of its hand-over (§7.3).
ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_given_check" CHECK (
  "kind" = 'GIVEN' OR ("confirmedAt" IS NULL AND "photoUrl" IS NULL)
);
