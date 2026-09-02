/*
  F-27 (Phase 1 of the plan): data model for MFA, trusted devices, and the
  shared email-verification-code mechanism (email verify, email change,
  MFA email-fallback recovery, forgot-password).

  mfaSecret is reversibly encrypted with MFA_ENCRYPTION_KEY (app-layer, not
  this migration) rather than hashed, since the server has to read it back
  to compute the expected TOTP code on every login — this is a different
  key from F-02's deleted ENCRYPTION_KEY, for a different purpose, kept
  deliberately distinct so the two are never confused.

  VerificationCode.codeHash and TrustedDevice.tokenHash are both hashed,
  not raw — neither the 6-digit email code nor the device cookie's token
  needs to be recoverable, only comparable.

  Both new tables use the same "optional userId / optional superAdminId"
  ownership pattern AuditLog already established, rather than a polymorphic
  single id+type column — exactly one of the two is ever set per row.

  Nothing here changes existing behavior: mfaEnabled defaults false and
  emailVerifiedAt defaults null for every existing row, so this migration
  alone doesn't block anyone's login. Enforcement is application logic,
  added in a later phase.
*/

CREATE TYPE "VerificationPurpose" AS ENUM ('EMAIL_VERIFY', 'EMAIL_CHANGE', 'MFA_RECOVERY', 'PASSWORD_RESET');

-- AlterTable: SuperAdmin
ALTER TABLE "SuperAdmin"
    ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "mfaSecret" TEXT,
    ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- AlterTable: User
ALTER TABLE "User"
    ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "mfaSecret" TEXT,
    ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable: VerificationCode
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "superAdminId" TEXT,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VerificationCode_userId_idx" ON "VerificationCode"("userId");
CREATE INDEX "VerificationCode_superAdminId_idx" ON "VerificationCode"("superAdminId");
CREATE INDEX "VerificationCode_email_purpose_idx" ON "VerificationCode"("email", "purpose");

ALTER TABLE "VerificationCode"
    ADD CONSTRAINT "VerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "VerificationCode_superAdminId_fkey" FOREIGN KEY ("superAdminId") REFERENCES "SuperAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: TrustedDevice
CREATE TABLE "TrustedDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "superAdminId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrustedDevice_tokenHash_key" ON "TrustedDevice"("tokenHash");
CREATE INDEX "TrustedDevice_userId_idx" ON "TrustedDevice"("userId");
CREATE INDEX "TrustedDevice_superAdminId_idx" ON "TrustedDevice"("superAdminId");

ALTER TABLE "TrustedDevice"
    ADD CONSTRAINT "TrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "TrustedDevice_superAdminId_fkey" FOREIGN KEY ("superAdminId") REFERENCES "SuperAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
