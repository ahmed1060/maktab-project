-- F-26 (retry) — see 20260902000001_task_company_status_idx for context.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "DayOffRequest_userId_status_idx" ON "DayOffRequest"("userId", "status");
