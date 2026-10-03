-- Face verification switches and consent (ATTENDANCE_PLAN.md §9.5, §10.4).
CREATE TYPE "FaceSystemState" AS ENUM ('OFF', 'ON', 'PAUSED');
ALTER TABLE "SystemSettings" ADD COLUMN "faceVerification" "FaceSystemState" NOT NULL DEFAULT 'OFF';
ALTER TABLE "SystemSettings" ADD COLUMN "faceVerificationChangedAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "faceLegalConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "faceLegalConfirmedById" TEXT;
ALTER TABLE "User" ADD COLUMN "faceVerificationRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "BiometricConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "textVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    CONSTRAINT "BiometricConsent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BiometricConsent_userId_acceptedAt_idx" ON "BiometricConsent"("userId", "acceptedAt");
ALTER TABLE "BiometricConsent" ADD CONSTRAINT "BiometricConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BiometricConsent" ADD CONSTRAINT "BiometricConsent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deciding face enrolments (§9.5): the built-in Admin role's new grant,
-- lib/permissions/built-in.ts row for row.
INSERT INTO "RoleGrant" ("roleId", "permission", "scope")
SELECT r."id", g."permission", g."scope"::"PermissionScope"
FROM "Role" r
JOIN (VALUES
    ('ADMIN', 'attendance.approve_face', 'COMPANY')
) AS g("builtIn", "permission", "scope") ON r."builtIn"::text = g."builtIn"
ON CONFLICT ("roleId", "permission") DO NOTHING;

UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now() WHERE "builtIn" = 'ADMIN';
