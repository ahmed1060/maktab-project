-- Derived attendance days (ATTENDANCE_PLAN.md §8.6, §11): what each person's
-- day was and what it costs, rebuilt by the engine from the calendar, the
-- policy and the punches. One row per person per date.

-- CreateEnum
CREATE TYPE "AttendanceDayStatus" AS ENUM ('PRESENT', 'ABSENT', 'INCOMPLETE', 'LEAVE', 'SUSPENDED', 'REST', 'HOLIDAY', 'WORKED_REST_DAY', 'WORKED_HOLIDAY', 'NO_SCHEDULE');

-- CreateTable
CREATE TABLE "AttendanceDay" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceDayStatus" NOT NULL,
    "scheduleId" TEXT,
    "scheduleVersionId" TEXT,
    "overrideId" TEXT,
    "policyId" TEXT,
    "expectedStartMinutes" INTEGER,
    "expectedEndMinutes" INTEGER,
    "breakMinutes" INTEGER,
    "punchCount" INTEGER NOT NULL DEFAULT 0,
    "firstInAt" TIMESTAMP(0),
    "lastOutAt" TIMESTAMP(0),
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "excusedMinutes" INTEGER NOT NULL DEFAULT 0,
    "deductionDays" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "deductionMinor" INTEGER NOT NULL DEFAULT 0,
    "overtimeStatus" TEXT NOT NULL DEFAULT 'NONE',
    "overtimeMinor" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB NOT NULL,
    "inputsHash" TEXT NOT NULL,
    "derivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedByPayrollRunId" TEXT,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id"),
    -- Measures and money are never negative: a credit is a different thing.
    CONSTRAINT "AttendanceDay_not_negative" CHECK ("workedMinutes" >= 0 AND "lateMinutes" >= 0 AND "earlyLeaveMinutes" >= 0 AND "overtimeMinutes" >= 0 AND "excusedMinutes" >= 0 AND "deductionDays" >= 0 AND "deductionMinor" >= 0 AND "overtimeMinor" >= 0),
    CONSTRAINT "AttendanceDay_overtime_status" CHECK ("overtimeStatus" IN ('NONE', 'PENDING', 'APPROVED', 'NOT_COUNTED'))
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDay_companyId_userId_date_key" ON "AttendanceDay"("companyId", "userId", "date");

-- CreateIndex
CREATE INDEX "AttendanceDay_companyId_date_idx" ON "AttendanceDay"("companyId", "date");

-- AddForeignKey
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
