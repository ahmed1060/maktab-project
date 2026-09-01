-- F-26: composite indexes for the query pairs the app actually filters on
-- together. Postgres can only use one single-column index per table scan,
-- so a query filtering on both columns of a pair below was doing more work
-- than it needed to even with the existing single-column indexes in place.
--
-- CONCURRENTLY, not a plain CREATE INDEX: the latter takes a lock that
-- blocks writes to the table for the duration of the build. On these
-- tables that's likely seconds today, but CONCURRENTLY costs nothing to
-- use now and means this migration is still safe to run without a
-- maintenance window once the tables are bigger. Prisma Migrate detects
-- CONCURRENTLY and runs this migration outside a transaction rather than
-- wrapping it in one (a transaction can't contain a CONCURRENTLY build) —
-- IF NOT EXISTS makes a retry after a partial failure safe either way.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_companyId_status_idx" ON "Task"("companyId", "status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_companyId_deadline_idx" ON "Task"("companyId", "deadline");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_userId_read_idx" ON "Notification"("userId", "read");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_createdAt_action_idx" ON "AuditLog"("createdAt", "action");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "DayOffRequest_userId_status_idx" ON "DayOffRequest"("userId", "status");
