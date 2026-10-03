-- The attendance policy (ATTENDANCE_PLAN.md §6, §8.3): a company's rules for
-- lateness, early leave, overtime, absence and permission hours, versioned
-- from a date, and the templates a company can start from.

-- CreateTable
CREATE TABLE "PolicyTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "description" TEXT,
    "body" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendancePolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "body" JSONB NOT NULL,
    "appliedTemplateId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyTemplate_name_key" ON "PolicyTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePolicy_companyId_effectiveFrom_key" ON "AttendancePolicy"("companyId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "AttendancePolicy" ADD CONSTRAINT "AttendancePolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The two starting templates (§6.8), the same values as STANDARD_OFFICE and
-- SIX_DAY_FACTORY in lib/attendance/policy.ts (lib/attendance-policy.test.ts
-- checks they agree). The Super Admin maintains them from here.
INSERT INTO "PolicyTemplate" ("id", "name", "nameAr", "description", "body", "updatedAt") VALUES
    (gen_random_uuid()::text, 'Standard Egyptian office', 'مكتب مصري قياسي', 'Sunday to Thursday, 15 minutes'' grace, lateness in quarter, half and whole days, overtime on approval, 4 permission hours a month.', '{"workWeek":[0,1,2,3,4],"lateness":{"enabled":true,"graceMinutes":15,"mode":"BANDS","bands":[{"fromMinutes":16,"toMinutes":30,"dayFraction":0.25},{"fromMinutes":31,"toMinutes":60,"dayFraction":0.5},{"fromMinutes":61,"toMinutes":null,"dayFraction":1}],"freePerMonth":2,"escalation":null,"monthlyCapDays":3},"earlyLeave":{"enabled":true,"graceMinutes":10,"mode":"BANDS","bands":[{"fromMinutes":11,"toMinutes":30,"dayFraction":0.25},{"fromMinutes":31,"toMinutes":60,"dayFraction":0.5},{"fromMinutes":61,"toMinutes":null,"dayFraction":1}],"freePerMonth":0,"escalation":null,"monthlyCapDays":3},"overtime":{"enabled":true,"minimumMinutes":30,"multipliers":{"workday":1.35,"restDay":2,"holiday":3},"requiresApproval":true,"compensation":"PAY"},"absence":{"multiplier":1},"permissionHours":{"enabled":true,"monthlyAllowanceMinutes":240,"minPerRequestMinutes":30,"maxPerRequestMinutes":120,"maxRequestsPerMonth":4,"afterTheFactHours":24,"carryOver":"LAPSE","types":["LATE_ARRIVAL","EARLY_LEAVE","MIDDAY"]},"noCheckInReminderMinutes":15}'::jsonb, now()),
    (gen_random_uuid()::text, 'Six-day factory', 'مصنع ستة أيام', 'Saturday to Thursday, 5 minutes'' grace, stricter lateness bands, 2 permission hours a month.', '{"workWeek":[6,0,1,2,3,4],"lateness":{"enabled":true,"graceMinutes":5,"mode":"BANDS","bands":[{"fromMinutes":6,"toMinutes":15,"dayFraction":0.25},{"fromMinutes":16,"toMinutes":30,"dayFraction":0.5},{"fromMinutes":31,"toMinutes":null,"dayFraction":1}],"freePerMonth":0,"escalation":null,"monthlyCapDays":3},"earlyLeave":{"enabled":true,"graceMinutes":10,"mode":"BANDS","bands":[{"fromMinutes":11,"toMinutes":30,"dayFraction":0.25},{"fromMinutes":31,"toMinutes":60,"dayFraction":0.5},{"fromMinutes":61,"toMinutes":null,"dayFraction":1}],"freePerMonth":0,"escalation":null,"monthlyCapDays":3},"overtime":{"enabled":true,"minimumMinutes":30,"multipliers":{"workday":1.35,"restDay":2,"holiday":3},"requiresApproval":true,"compensation":"PAY"},"absence":{"multiplier":1},"permissionHours":{"enabled":true,"monthlyAllowanceMinutes":120,"minPerRequestMinutes":30,"maxPerRequestMinutes":60,"maxRequestsPerMonth":2,"afterTheFactHours":24,"carryOver":"LAPSE","types":["LATE_ARRIVAL","EARLY_LEAVE","MIDDAY"]},"noCheckInReminderMinutes":15}'::jsonb, now())
ON CONFLICT ("name") DO NOTHING;
