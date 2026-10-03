-- The one phone each person checks in from (ATTENDANCE_PLAN.md §9.2, §9.3).
CREATE TYPE "CheckInPhoneStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'REVOKED', 'WITHDRAWN');
CREATE TYPE "PhonePlatform" AS ENUM ('ANDROID', 'IOS');

CREATE TABLE "CheckInPhone" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "keyFingerprint" TEXT NOT NULL,
    "platform" "PhonePlatform" NOT NULL,
    "model" TEXT,
    "appVersion" TEXT,
    "attested" BOOLEAN NOT NULL DEFAULT false,
    "status" "CheckInPhoneStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "reason" TEXT,

    CONSTRAINT "CheckInPhone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckInPhone_keyFingerprint_key" ON "CheckInPhone"("keyFingerprint");
CREATE INDEX "CheckInPhone_companyId_status_idx" ON "CheckInPhone"("companyId", "status");
CREATE INDEX "CheckInPhone_userId_idx" ON "CheckInPhone"("userId");
-- At most one phone in use, and one asked for, per person (§9.3).
CREATE UNIQUE INDEX "CheckInPhone_one_active" ON "CheckInPhone"("userId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "CheckInPhone_one_pending" ON "CheckInPhone"("userId") WHERE "status" = 'PENDING';

ALTER TABLE "CheckInPhone" ADD CONSTRAINT "CheckInPhone_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckInPhone" ADD CONSTRAINT "CheckInPhone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One-time numbers a phone signs (§9.2).
CREATE TABLE "AttendanceChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendanceChallenge_nonceHash_key" ON "AttendanceChallenge"("nonceHash");
CREATE INDEX "AttendanceChallenge_userId_idx" ON "AttendanceChallenge"("userId");
CREATE INDEX "AttendanceChallenge_expiresAt_idx" ON "AttendanceChallenge"("expiresAt");
ALTER TABLE "AttendanceChallenge" ADD CONSTRAINT "AttendanceChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Which phone a check-in came from.
ALTER TABLE "AttendancePunch" ADD COLUMN "phoneId" TEXT;
CREATE INDEX "AttendancePunch_phoneId_idx" ON "AttendancePunch"("phoneId");
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_phoneId_fkey" FOREIGN KEY ("phoneId") REFERENCES "CheckInPhone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Approving phones (§9.3): the built-in Admin role's new grant,
-- lib/permissions/built-in.ts row for row.
INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
SELECT r."id", g."permission", g."scope"::"PermissionScope"
FROM "Role" r
JOIN (VALUES
    ('ADMIN', 'attendance.approve_devices', 'COMPANY')
) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
ON CONFLICT ("roleId", "permission") DO NOTHING;

-- Holders reload their grants within a minute.
UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now() WHERE "builtIn" = 'ADMIN';
