-- Costs paid from cash advances (CLIENTS_PLAN.md §7.2, §7.4, step 7b): a
-- cost keeps the part its author's advance paid as it was added, and the
-- advance a Spent entry on that cost and its task, taken off as the cost is
-- added and put back as it's removed. Only added: the release before writes
-- costs as it did, none of them from an advance, and records no Spent entry.
ALTER TABLE "TaskCost" ADD COLUMN "fromAdvance" DECIMAL(12,2) NOT NULL DEFAULT 0;
-- Never below nothing, nor more than the cost.
ALTER TABLE "TaskCost" ADD CONSTRAINT "TaskCost_fromAdvance_check" CHECK ("fromAdvance" >= 0 AND "fromAdvance" <= "amount");

ALTER TABLE "CashAdvanceEntry" ADD COLUMN "costId" TEXT, ADD COLUMN "taskId" TEXT;
CREATE INDEX "CashAdvanceEntry_costId_idx" ON "CashAdvanceEntry"("costId");
CREATE INDEX "CashAdvanceEntry_taskId_idx" ON "CashAdvanceEntry"("taskId");
ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_costId_fkey" FOREIGN KEY ("costId") REFERENCES "TaskCost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A Spent entry is never of nothing, as a correction isn't; and only a
-- Spent one is on a cost or a task.
ALTER TABLE "CashAdvanceEntry" DROP CONSTRAINT "CashAdvanceEntry_amount_check";
ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_amount_check" CHECK (
  ("kind" <> 'GIVEN' OR "amount" > 0) AND ("kind" <> 'RETURNED' OR "amount" < 0) AND ("kind" NOT IN ('CORRECTION', 'SPENT') OR "amount" <> 0)
);
ALTER TABLE "CashAdvanceEntry" ADD CONSTRAINT "CashAdvanceEntry_spent_check" CHECK (
  "kind" = 'SPENT' OR ("costId" IS NULL AND "taskId" IS NULL)
);
