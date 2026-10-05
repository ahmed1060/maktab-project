-- Attendance requests (ATTENDANCE_PLAN.md §6.4, §6.6, §8.4): permission hours
-- (إذن), decisions on overtime, and reports of a missing punch.

-- CreateEnum
CREATE TYPE "AttendanceRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PermissionType" AS ENUM ('LATE_ARRIVAL', 'EARLY_LEAVE', 'MIDDAY');

-- CreateTable
CREATE TABLE "PermissionRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "PermissionType" NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AttendanceRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "PermissionRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PermissionRequest_span" CHECK ("startMinutes" >= 0 AND "endMinutes" > "startMinutes" AND "endMinutes" <= 2880 AND "minutes" = "endMinutes" - "startMinutes")
);

-- CreateTable
CREATE TABLE "OvertimeApproval" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceRequestStatus" NOT NULL,
    "approvedMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OvertimeApproval_pkey" PRIMARY KEY ("id"),
    -- A decision is made: approved (for some minutes) or rejected (for none).
    CONSTRAINT "OvertimeApproval_decided" CHECK (("status" = 'APPROVED' AND "approvedMinutes" > 0) OR ("status" = 'REJECTED' AND "approvedMinutes" = 0))
);

-- CreateTable
CREATE TABLE "MissingPunchRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "claimedAt" TIMESTAMP(0) NOT NULL,
    "direction" "PunchDirection",
    "reason" TEXT NOT NULL,
    "status" "AttendanceRequestStatus" NOT NULL DEFAULT 'PENDING',
    "punchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "MissingPunchRequest_pkey" PRIMARY KEY ("id"),
    -- An approved report always added its punch.
    CONSTRAINT "MissingPunchRequest_approved_has_punch" CHECK ("status" <> 'APPROVED' OR "punchId" IS NOT NULL)
);

-- CreateIndex
CREATE INDEX "PermissionRequest_companyId_status_idx" ON "PermissionRequest"("companyId", "status");
CREATE INDEX "PermissionRequest_userId_date_idx" ON "PermissionRequest"("userId", "date");
CREATE UNIQUE INDEX "OvertimeApproval_userId_date_key" ON "OvertimeApproval"("userId", "date");
CREATE INDEX "OvertimeApproval_companyId_date_idx" ON "OvertimeApproval"("companyId", "date");
CREATE INDEX "MissingPunchRequest_companyId_status_idx" ON "MissingPunchRequest"("companyId", "status");
CREATE INDEX "MissingPunchRequest_userId_date_idx" ON "MissingPunchRequest"("userId", "date");

-- AddForeignKey
ALTER TABLE "PermissionRequest" ADD CONSTRAINT "PermissionRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PermissionRequest" ADD CONSTRAINT "PermissionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OvertimeApproval" ADD CONSTRAINT "OvertimeApproval_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OvertimeApproval" ADD CONSTRAINT "OvertimeApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissingPunchRequest" ADD CONSTRAINT "MissingPunchRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissingPunchRequest" ADD CONSTRAINT "MissingPunchRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A day's overtime can now be rejected.
ALTER TABLE "AttendanceDay" DROP CONSTRAINT "AttendanceDay_overtime_status";
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_overtime_status" CHECK ("overtimeStatus" IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED', 'NOT_COUNTED'));

-- The built-in Admin role's new grants: lib/permissions/built-in.ts, row for
-- row. They open nothing for a company without the attendance add-on.
INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
SELECT r."id", g."permission", g."scope"::"PermissionScope"
FROM "Role" r
JOIN (VALUES
    ('ADMIN', 'attendance.approve_overtime', 'COMPANY'),
    ('ADMIN', 'attendance.approve_permissions', 'COMPANY')
) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
ON CONFLICT ("roleId", "permission") DO NOTHING;

-- Holders reload their grants within a minute.
UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now() WHERE "builtIn" = 'ADMIN';
