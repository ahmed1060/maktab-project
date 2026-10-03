-- The company's default schedule becomes dated (review on #10). A flag on the
-- schedule meant making another one the default moved every unassigned person
-- for every date, approved payroll months included. Now each change says from
-- when, like the hours and the assignments.

-- CreateTable
CREATE TABLE "ScheduleDefault" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleDefault_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleDefault_scheduleId_idx" ON "ScheduleDefault"("scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleDefault_companyId_effectiveFrom_key" ON "ScheduleDefault"("companyId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "ScheduleDefault" ADD CONSTRAINT "ScheduleDefault_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleDefault" ADD CONSTRAINT "ScheduleDefault_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Each company's current default, from the first day its schedule had hours.
INSERT INTO "ScheduleDefault" ("id", "companyId", "scheduleId", "effectiveFrom", "createdById")
SELECT gen_random_uuid()::text, s."companyId", s."id", MIN(v."effectiveFrom"), MIN(v."createdById")
FROM "WorkSchedule" s
JOIN "ScheduleVersion" v ON v."scheduleId" = s."id"
WHERE s."isDefault"
GROUP BY s."companyId", s."id";

DROP INDEX "WorkSchedule_one_default";
ALTER TABLE "WorkSchedule" DROP COLUMN "isDefault";
