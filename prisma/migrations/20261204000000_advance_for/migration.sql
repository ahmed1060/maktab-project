-- An advance for a particular task or client (CLIENTS_PLAN.md §7.9, step
-- 7e): each entry is for one task or one client, or neither, the running
-- balance, and what's held for each is its entries' sum. Money for one is
-- moved to the running balance as a pair of entries of their own. Only
-- added: the release before records every entry for neither, as before.
ALTER TYPE "CashAdvanceEntryKind" ADD VALUE 'MOVED';

ALTER TABLE "CashAdvanceEntry" ADD COLUMN "forTaskId" TEXT, ADD COLUMN "forClientId" TEXT;
CREATE INDEX "CashAdvanceEntry_forTaskId_idx" ON "CashAdvanceEntry"("forTaskId");
CREATE INDEX "CashAdvanceEntry_forClientId_idx" ON "CashAdvanceEntry"("forClientId");
-- A task or a client gone, what was for it is the running balance's.
ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_forTaskId_fkey" FOREIGN KEY ("forTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_forClientId_fkey" FOREIGN KEY ("forClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- For one task or one client, never both.
ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_for_check" CHECK (num_nonnulls("forTaskId", "forClientId") <= 1);

-- One moved is never of nothing. Compared as text: a value added to a type
-- can't be used as one in the transaction adding it.
ALTER TABLE "CashAdvanceEntry" DROP CONSTRAINT "CashAdvanceEntry_amount_check";
ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_amount_check" CHECK (
  ("kind" <> 'GIVEN' OR "amount" > 0) AND ("kind" <> 'RETURNED' OR "amount" < 0) AND ("kind" NOT IN ('CORRECTION', 'SPENT') OR "amount" <> 0)
  AND ("kind"::text <> 'DEBT' OR "amount" < 0) AND ("kind"::text <> 'MOVED' OR "amount" <> 0)
);
