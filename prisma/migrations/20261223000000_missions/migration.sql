-- Missions (مأمورية; ATTENDANCE_PLAN.md §6.10, round 10, Phase 5 part 4,
-- PR 281): an employee sent to work away from their desk, for whole days or
-- for part of one, so the day isn't charged as late, early or absent. This
-- PR holds them and reads the approved ones into each day; the Requests page
-- asks for and decides them in the next PR, so for now no row is written.
CREATE TYPE "MissionKind" AS ENUM ('DAYS', 'HOURS');

-- A mission by hours covers the day until its end, or from its start
-- (decision 15).
CREATE TYPE "MissionHoursPart" AS ENUM ('TO_END', 'FROM_START');

-- Its own, as a mission is withdrawn while it waits and cancelled once
-- approved (decision 25), which permission hours tell apart by nothing.
CREATE TYPE "MissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED');

CREATE TABLE "MissionRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "MissionKind" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "hoursPart" "MissionHoursPart",
    -- One of the employee's open tasks, for whoever decides it (decision 18);
    -- its title is kept, so a task deleted since still names it.
    "taskId" TEXT,
    "taskTitle" TEXT,
    "reason" TEXT NOT NULL,
    "status" "MissionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "MissionRequest_pkey" PRIMARY KEY ("id"),
    -- A mission by hours is one date and says which part of it; one by days doesn't.
    CONSTRAINT "MissionRequest_kind_check" CHECK (
        ("kind" = 'HOURS' AND "hoursPart" IS NOT NULL AND "endDate" = "startDate")
        OR ("kind" = 'DAYS' AND "hoursPart" IS NULL)
    ),
    CONSTRAINT "MissionRequest_dates_check" CHECK ("endDate" >= "startDate")
);

CREATE INDEX "MissionRequest_companyId_status_idx" ON "MissionRequest"("companyId", "status");
CREATE INDEX "MissionRequest_userId_startDate_idx" ON "MissionRequest"("userId", "startDate");
CREATE INDEX "MissionRequest_taskId_idx" ON "MissionRequest"("taskId");

ALTER TABLE "MissionRequest" ADD CONSTRAINT "MissionRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissionRequest" ADD CONSTRAINT "MissionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissionRequest" ADD CONSTRAINT "MissionRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Each working day of an approved mission by days (§6.10). Only adds a
-- value: no day is read or changed here, and the engine works days out
-- again on a new scan, a decision, a policy change or the nightly run.
ALTER TYPE "AttendanceDayStatus" ADD VALUE 'MISSION';

-- Every table has Row Level Security on (DATABASE_SETUP.md).
ALTER TABLE "MissionRequest" ENABLE ROW LEVEL SECURITY;
