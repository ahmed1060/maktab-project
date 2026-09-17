-- Employment timeline. Additive throughout: one new enum value, one new enum,
-- one new table, and an insert that only touches users with no row yet.

-- ARCHIVED is the end of a contract: login gone, record kept whole. Distinct
-- from SUSPENDED (temporary, reversible) and DELETED (an administrative
-- removal rather than the end of employment).
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

CREATE TYPE "EmploymentEventType" AS ENUM ('HIRED', 'SUSPENDED', 'UNSUSPENDED', 'CONTRACT_ENDED', 'REINSTATED');

CREATE TABLE "EmploymentEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "EmploymentEventType" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "deductSuspension" BOOLEAN,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmploymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmploymentEvent_userId_effectiveFrom_idx" ON "EmploymentEvent"("userId", "effectiveFrom");

ALTER TABLE "EmploymentEvent" ADD CONSTRAINT "EmploymentEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill, on the same reasoning as SalaryChange's: the epoch rather than a
-- hire date, because there is no hire date. Without a HIRED event the timeline
-- has no start, and every month would read as "not employed" — which would
-- value every historical payslip at zero rather than refusing to compute.
INSERT INTO "EmploymentEvent" ("id", "userId", "type", "effectiveFrom", "reason", "createdById", "createdAt")
SELECT
    gen_random_uuid()::text,
    u."id",
    'HIRED',
    TIMESTAMP '1970-01-01 00:00:00',
    'Backfilled. The date this employment actually began is not recorded.',
    NULL,
    CURRENT_TIMESTAMP
FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "EmploymentEvent" e WHERE e."userId" = u."id");

-- Anyone already suspended gets the matching open event, so the timeline agrees
-- with User.status on day one rather than reporting them as working.
INSERT INTO "EmploymentEvent" ("id", "userId", "type", "effectiveFrom", "reason", "createdById", "createdAt")
SELECT
    gen_random_uuid()::text,
    u."id",
    'SUSPENDED',
    TIMESTAMP '1970-01-01 00:00:01',
    'Backfilled from the current status. The date this suspension began is not recorded.',
    NULL,
    CURRENT_TIMESTAMP
FROM "User" u
WHERE u."status" = 'SUSPENDED'
  AND NOT EXISTS (
    SELECT 1 FROM "EmploymentEvent" e
    WHERE e."userId" = u."id" AND e."type" = 'SUSPENDED'
  );
