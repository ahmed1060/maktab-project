-- F-26 (retry): CREATE INDEX CONCURRENTLY must be the only statement in its
-- migration file, or Prisma wraps the file in a transaction and Postgres
-- rejects CONCURRENTLY inside one (P3018). The original 5-statement
-- 20260901160000_composite_indexes migration hit exactly that and got stuck
-- half-applied; it's resolved (rolled back) in _prisma_migrations and
-- superseded by this file and 4 siblings, one statement each.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_companyId_status_idx" ON "Task"("companyId", "status");
