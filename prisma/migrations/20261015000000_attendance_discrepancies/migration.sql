-- Changes after the lock (ATTENDANCE_PLAN.md §12.3): a paid day is never
-- rewritten; what it would now be is recorded for an adjustment instead.

-- CreateTable
CREATE TABLE "AttendanceDiscrepancy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "paidDeductionMinor" INTEGER NOT NULL,
    "paidOvertimeMinor" INTEGER NOT NULL,
    "nowDeductionMinor" INTEGER NOT NULL,
    "nowOvertimeMinor" INTEGER NOT NULL,
    "paidStatus" TEXT NOT NULL,
    "nowStatus" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,

    CONSTRAINT "AttendanceDiscrepancy_pkey" PRIMARY KEY ("id"),
    -- Resolved means somebody, saying how.
    CONSTRAINT "AttendanceDiscrepancy_resolved" CHECK (("resolvedAt" IS NULL) = ("resolvedById" IS NULL) AND ("resolvedAt" IS NULL OR length(trim("resolution")) > 0))
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDiscrepancy_userId_date_key" ON "AttendanceDiscrepancy"("userId", "date");
CREATE INDEX "AttendanceDiscrepancy_companyId_resolvedAt_idx" ON "AttendanceDiscrepancy"("companyId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "AttendanceDiscrepancy" ADD CONSTRAINT "AttendanceDiscrepancy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceDiscrepancy" ADD CONSTRAINT "AttendanceDiscrepancy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
