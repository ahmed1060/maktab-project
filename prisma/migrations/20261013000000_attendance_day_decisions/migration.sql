-- Decisions on a day from the exceptions screen (ATTENDANCE_PLAN.md §13.1):
-- lateness, early leave or an absence excused, or accepted as charged.

-- CreateEnum
CREATE TYPE "AttendanceSubject" AS ENUM ('LATENESS', 'EARLY_LEAVE', 'ABSENCE');

-- CreateEnum
CREATE TYPE "AttendanceDecisionOutcome" AS ENUM ('EXCUSED', 'ACCEPTED');

-- CreateTable
CREATE TABLE "AttendanceDayDecision" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "subject" "AttendanceSubject" NOT NULL,
    "outcome" "AttendanceDecisionOutcome" NOT NULL,
    "reason" TEXT,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDayDecision_pkey" PRIMARY KEY ("id"),
    -- An excuse always says why.
    CONSTRAINT "AttendanceDayDecision_excuse_has_reason" CHECK ("outcome" <> 'EXCUSED' OR length(trim("reason")) > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDayDecision_userId_date_subject_key" ON "AttendanceDayDecision"("userId", "date", "subject");
CREATE INDEX "AttendanceDayDecision_companyId_date_idx" ON "AttendanceDayDecision"("companyId", "date");

-- AddForeignKey
ALTER TABLE "AttendanceDayDecision" ADD CONSTRAINT "AttendanceDayDecision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceDayDecision" ADD CONSTRAINT "AttendanceDayDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
