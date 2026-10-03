-- The attendance calendar (ATTENDANCE_PLAN.md §7, §8.3): schedules and their
-- dated versions and overrides, who works which, and the holidays.

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleVersion" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "workWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    CONSTRAINT "ScheduleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleDay" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,

    CONSTRAINT "ScheduleDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleOverride" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleOverrideDay" (
    "id" TEXT NOT NULL,
    "overrideId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,

    CONSTRAINT "ScheduleOverrideDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicHoliday" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'EG',
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyHoliday" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyHolidayExclusion" (
    "companyId" TEXT NOT NULL,
    "publicHolidayId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyHolidayExclusion_pkey" PRIMARY KEY ("companyId","publicHolidayId")
);

-- CreateIndex
CREATE INDEX "WorkSchedule_companyId_idx" ON "WorkSchedule"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSchedule_companyId_name_key" ON "WorkSchedule"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleVersion_scheduleId_effectiveFrom_key" ON "ScheduleVersion"("scheduleId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleDay_versionId_weekday_key" ON "ScheduleDay"("versionId", "weekday");

-- CreateIndex
CREATE INDEX "ScheduleOverride_scheduleId_startDate_idx" ON "ScheduleOverride"("scheduleId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleOverrideDay_overrideId_weekday_key" ON "ScheduleOverrideDay"("overrideId", "weekday");

-- CreateIndex
CREATE INDEX "UserSchedule_scheduleId_idx" ON "UserSchedule"("scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSchedule_userId_effectiveFrom_key" ON "UserSchedule"("userId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PublicHoliday_country_date_key" ON "PublicHoliday"("country", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHoliday_companyId_date_key" ON "CompanyHoliday"("companyId", "date");

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleVersion" ADD CONSTRAINT "ScheduleVersion_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleDay" ADD CONSTRAINT "ScheduleDay_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ScheduleVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleOverride" ADD CONSTRAINT "ScheduleOverride_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleOverrideDay" ADD CONSTRAINT "ScheduleOverrideDay_overrideId_fkey" FOREIGN KEY ("overrideId") REFERENCES "ScheduleOverride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSchedule" ADD CONSTRAINT "UserSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSchedule" ADD CONSTRAINT "UserSchedule_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyHoliday" ADD CONSTRAINT "CompanyHoliday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyHolidayExclusion" ADD CONSTRAINT "CompanyHolidayExclusion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyHolidayExclusion" ADD CONSTRAINT "CompanyHolidayExclusion_publicHolidayId_fkey" FOREIGN KEY ("publicHolidayId") REFERENCES "PublicHoliday"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Rules the services enforce, held by the database too.
ALTER TABLE "ScheduleVersion" ADD CONSTRAINT "ScheduleVersion_hours"
    CHECK ("startMinutes" >= 0 AND "startMinutes" < 1440 AND "endMinutes" > "startMinutes" AND "endMinutes" <= "startMinutes" + 1440
           AND "breakMinutes" >= 0 AND "breakMinutes" < "endMinutes" - "startMinutes"),
    ADD CONSTRAINT "ScheduleVersion_workWeek" CHECK ("workWeek" <@ ARRAY[0,1,2,3,4,5,6]);
ALTER TABLE "ScheduleDay" ADD CONSTRAINT "ScheduleDay_hours"
    CHECK ("weekday" BETWEEN 0 AND 6 AND "startMinutes" >= 0 AND "startMinutes" < 1440
           AND "endMinutes" > "startMinutes" AND "endMinutes" <= "startMinutes" + 1440);
ALTER TABLE "ScheduleOverride" ADD CONSTRAINT "ScheduleOverride_dates" CHECK ("endDate" >= "startDate"),
    ADD CONSTRAINT "ScheduleOverride_hours"
    CHECK ("startMinutes" >= 0 AND "startMinutes" < 1440 AND "endMinutes" > "startMinutes" AND "endMinutes" <= "startMinutes" + 1440
           AND "breakMinutes" >= 0 AND "breakMinutes" < "endMinutes" - "startMinutes");
ALTER TABLE "ScheduleOverrideDay" ADD CONSTRAINT "ScheduleOverrideDay_hours"
    CHECK ("weekday" BETWEEN 0 AND 6 AND "startMinutes" >= 0 AND "startMinutes" < 1440
           AND "endMinutes" > "startMinutes" AND "endMinutes" <= "startMinutes" + 1440);

-- At most one default schedule per company among those in use.
CREATE UNIQUE INDEX "WorkSchedule_one_default" ON "WorkSchedule"("companyId") WHERE "isDefault" AND "archivedAt" IS NULL;

-- A starting central calendar: Egypt's fixed-date public holidays for 2026 and
-- 2027. The Super Admin adds the lunar ones (Eid, the Prophet's Birthday, the
-- Islamic New Year) once each year's dates are announced, and moves any day a
-- decree moves; companies follow automatically.
INSERT INTO "PublicHoliday" ("id", "country", "date", "name", "nameAr", "updatedAt")
SELECT gen_random_uuid()::text, 'EG', make_date(y, h.m, h.d), h.name, h."nameAr", now()
FROM (VALUES (2026), (2027)) AS years(y)
CROSS JOIN (VALUES
    (1, 7, 'Coptic Christmas', 'عيد الميلاد المجيد'),
    (1, 25, 'Revolution Day and Police Day', 'عيد ثورة 25 يناير وعيد الشرطة'),
    (4, 25, 'Sinai Liberation Day', 'عيد تحرير سيناء'),
    (5, 1, 'Labour Day', 'عيد العمال'),
    (6, 30, 'June 30 Revolution Day', 'ذكرى ثورة 30 يونيو'),
    (7, 23, 'Revolution Day', 'عيد ثورة 23 يوليو'),
    (10, 6, 'Armed Forces Day', 'عيد القوات المسلحة')
) AS h(m, d, name, "nameAr")
ON CONFLICT ("country", "date") DO NOTHING;
