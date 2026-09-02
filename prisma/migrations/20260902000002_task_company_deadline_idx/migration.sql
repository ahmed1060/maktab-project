-- F-26 (retry) — see 20260902000001_task_company_status_idx for context.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_companyId_deadline_idx" ON "Task"("companyId", "deadline");
