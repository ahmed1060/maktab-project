-- Client charges (CLIENTS_PLAN.md §6, step 6b): a cost on a task with a
-- client is charged to that client. The cost keeps the service fee on top of
-- it, whether it's left off the client's bill, and when its charge was
-- collected, and by whom. Added with defaults, so the release before, which
-- never names them, writes costs as it did: charged, with no fee.
ALTER TABLE "TaskCost"
  ADD COLUMN "serviceFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "notCharged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "collectedAt" TIMESTAMP(3),
  ADD COLUMN "collectedById" TEXT;

-- A fee is never negative, so the total is never below what was paid (§6.3).
ALTER TABLE "TaskCost" ADD CONSTRAINT "TaskCost_serviceFee_check" CHECK ("serviceFee" >= 0);
-- One left off the bill isn't collected.
ALTER TABLE "TaskCost" ADD CONSTRAINT "TaskCost_notCharged_check" CHECK (NOT ("notCharged" AND "collectedAt" IS NOT NULL));
