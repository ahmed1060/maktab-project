-- Punches (ATTENDANCE_PLAN.md §8.6): every clock-in and clock-out as it
-- arrived, from a spreadsheet or added by hand for now, with the employee
-- numbers that say who a terminal's numbers are. Raw punches are evidence:
-- withdrawn, never edited or deleted.

-- CreateEnum
CREATE TYPE "PunchSource" AS ENUM ('IMPORT', 'MOBILE', 'AGENT', 'DEVICE_PUSH', 'MANUAL');

-- CreateEnum
CREATE TYPE "PunchDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "PunchStatus" AS ENUM ('ACCEPTED', 'PENDING_DEVICE', 'FLAGGED', 'REJECTED');

-- CreateTable
CREATE TABLE "AttendancePunch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "source" "PunchSource" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "importId" TEXT,
    "hardwareUserId" TEXT,
    "punchAtLocal" TIMESTAMP(0) NOT NULL,
    "punchAt" TIMESTAMP(3) NOT NULL,
    "resolvedWithTimeZone" TEXT NOT NULL,
    "direction" "PunchDirection",
    "status" "PunchStatus" NOT NULL DEFAULT 'ACCEPTED',
    "note" TEXT,
    "createdById" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "AttendancePunch_pkey" PRIMARY KEY ("id"),
    -- A punch with no person must carry the number that will find it one.
    CONSTRAINT "AttendancePunch_has_someone" CHECK ("userId" IS NOT NULL OR "hardwareUserId" IS NOT NULL),
    -- Withdrawn means when, by whom and why, all three or none.
    CONSTRAINT "AttendancePunch_void_complete" CHECK (("voidedAt" IS NULL) = ("voidedById" IS NULL) AND ("voidedAt" IS NULL) = ("voidReason" IS NULL))
);

-- CreateTable
CREATE TABLE "AttendanceImport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "addedCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "refusedCount" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "AttendanceImport_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AttendanceImport_void_complete" CHECK (("voidedAt" IS NULL) = ("voidedById" IS NULL) AND ("voidedAt" IS NULL) = ("voidReason" IS NULL))
);

-- CreateTable
CREATE TABLE "AttendanceCode" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceCode_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AttendanceCode_not_blank" CHECK (btrim("code") <> '')
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePunch_companyId_source_sourceKey_key" ON "AttendancePunch"("companyId", "source", "sourceKey");

-- CreateIndex
CREATE INDEX "AttendancePunch_companyId_userId_punchAtLocal_idx" ON "AttendancePunch"("companyId", "userId", "punchAtLocal");

-- CreateIndex
CREATE INDEX "AttendancePunch_companyId_hardwareUserId_idx" ON "AttendancePunch"("companyId", "hardwareUserId");

-- CreateIndex
CREATE INDEX "AttendancePunch_importId_idx" ON "AttendancePunch"("importId");

-- CreateIndex
CREATE INDEX "AttendanceImport_companyId_createdAt_idx" ON "AttendanceImport"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceCode_companyId_code_key" ON "AttendanceCode"("companyId", "code");

-- CreateIndex
CREATE INDEX "AttendanceCode_userId_idx" ON "AttendanceCode"("userId");

-- AddForeignKey
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_importId_fkey" FOREIGN KEY ("importId") REFERENCES "AttendanceImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceImport" ADD CONSTRAINT "AttendanceImport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCode" ADD CONSTRAINT "AttendanceCode_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCode" ADD CONSTRAINT "AttendanceCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The built-in Admin role's new grants: lib/permissions/built-in.ts, row for
-- row. They open nothing for a company without the attendance add-on.
INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
SELECT r."id", g."permission", g."scope"::"PermissionScope"
FROM "Role" r
JOIN (VALUES
    ('ADMIN', 'attendance.view_team', 'COMPANY'),
    ('ADMIN', 'attendance.correct', 'COMPANY')
) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
ON CONFLICT ("roleId", "permission") DO NOTHING;

-- Holders reload their grants within a minute.
UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now() WHERE "builtIn" = 'ADMIN';
