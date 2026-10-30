-- Leaving the company with a cash advance still held (CLIENTS_PLAN.md §7.3,
-- step 7d): the balance becomes a debt, its source the advance, and an entry
-- of its own takes the balance to nothing. The debt names the entry as its
-- source. Only added: the release before records no such entry, and no
-- company holds advance money until the Super Admin allows them (§7.6).
ALTER TYPE "CashAdvanceEntryKind" ADD VALUE 'DEBT';

-- One that became a debt only ever takes the balance down. Compared as text:
-- a value added to a type can't be used as one in the transaction adding it.
ALTER TABLE "CashAdvanceEntry" DROP CONSTRAINT "CashAdvanceEntry_amount_check";
ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_amount_check" CHECK (
  ("kind" <> 'GIVEN' OR "amount" > 0) AND ("kind" <> 'RETURNED' OR "amount" < 0) AND ("kind" NOT IN ('CORRECTION', 'SPENT') OR "amount" <> 0)
  AND ("kind"::text <> 'DEBT' OR "amount" < 0)
);
