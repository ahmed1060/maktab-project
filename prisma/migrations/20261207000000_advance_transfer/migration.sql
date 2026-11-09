-- What's held for a task follows it when it's transferred (CLIENTS_PLAN.md
-- §7.9, step 7h): a pair of entries of a kind of its own, taken from the
-- original and added to its copy. Passed from someone left off to someone
-- on the copy, each entry names the other person, and the one added waits
-- for its receiver to confirm it, as an advance given does. Only added and
-- loosened: nothing already saved changes, and the release before writes
-- none of these.
ALTER TYPE "CashAdvanceEntryKind" ADD VALUE 'TRANSFERRED';

-- Who the money came from, or went to, by name then: a user, so no relation.
ALTER TABLE "CashAdvanceEntry" ADD COLUMN "counterpartName" TEXT;

-- One moved with a transfer is never of nothing. Compared as text: a value
-- added to a type can't be used as one in the transaction adding it.
ALTER TABLE "CashAdvanceEntry" DROP CONSTRAINT "CashAdvanceEntry_amount_check";
ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_amount_check" CHECK (
  ("kind" <> 'GIVEN' OR "amount" > 0) AND ("kind" <> 'RETURNED' OR "amount" < 0) AND ("kind" NOT IN ('CORRECTION', 'SPENT') OR "amount" <> 0)
  AND ("kind"::text <> 'DEBT' OR "amount" < 0) AND ("kind"::text <> 'MOVED' OR "amount" <> 0) AND ("kind"::text <> 'TRANSFERRED' OR "amount" <> 0)
);

-- An advance given is confirmed, and may have a photo of its hand-over
-- (§7.3); money passed on with a transfer is confirmed by whoever took it.
-- Nothing else is either.
ALTER TABLE "CashAdvanceEntry" DROP CONSTRAINT "CashAdvanceEntry_given_check";
ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_given_check" CHECK (
  "kind" = 'GIVEN' OR ("photoUrl" IS NULL AND ("confirmedAt" IS NULL OR ("kind"::text = 'TRANSFERRED' AND "amount" > 0)))
);
