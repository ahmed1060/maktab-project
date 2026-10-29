-- A receipt photo for each cost (CLIENTS_PLAN.md §6.2, step 6a): optional,
-- and on one cost only. Nullable and added alone, so the release before,
-- which never names it, reads and writes costs as it did.
ALTER TABLE "TaskCost" ADD COLUMN "receiptUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TaskCost_receiptUrl_key" ON "TaskCost"("receiptUrl");
