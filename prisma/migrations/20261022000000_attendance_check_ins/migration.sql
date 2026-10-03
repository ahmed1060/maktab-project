-- Checking in with the app (ATTENDANCE_PLAN.md §9.4, §9.6).
ALTER TABLE "AttendancePunch" ADD COLUMN "flagReasons" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AttendancePunch" ADD COLUMN "workLocationId" TEXT;
ALTER TABLE "AttendancePunch" ADD COLUMN "checkIn" JSONB;
CREATE INDEX "AttendancePunch_companyId_status_idx" ON "AttendancePunch"("companyId", "status");
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Check-ins refused outright, for the integrity view (§13.7).
CREATE TABLE "CheckInRefusal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneId" TEXT,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "details" JSONB,

    CONSTRAINT "CheckInRefusal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CheckInRefusal_companyId_at_idx" ON "CheckInRefusal"("companyId", "at");
CREATE INDEX "CheckInRefusal_at_idx" ON "CheckInRefusal"("at");
ALTER TABLE "CheckInRefusal" ADD CONSTRAINT "CheckInRefusal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckInRefusal" ADD CONSTRAINT "CheckInRefusal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
