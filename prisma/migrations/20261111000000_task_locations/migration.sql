-- The location a task is done at (CLIENTS_PLAN.md §2.3). Tasks from before
-- keep their typed text and link none (§2.5). A location goes only with its
-- client; its tasks keep their text then.
ALTER TABLE "Task" ADD COLUMN "locationId" TEXT;

CREATE INDEX "Task_locationId_idx" ON "Task"("locationId");

ALTER TABLE "Task" ADD CONSTRAINT "Task_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
