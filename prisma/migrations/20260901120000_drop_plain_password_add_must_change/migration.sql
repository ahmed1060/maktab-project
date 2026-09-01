/*
  Warnings:

  - You are about to drop the column `plainPasswordEnc` on the `SuperAdmin` table. All the data in that column will be permanently lost.
  - You are about to drop the column `plainPasswordEnc` on the `User` table. All the data in that column will be permanently lost.

  This is intentional (F-02 of the security audit): both tables stored every
  password ever set for a user, encrypted with a key that shipped in source
  with a hardcoded fallback — effectively a recoverable, not hashed,
  password store. The bcrypt `password` column is untouched and remains
  the only credential check. In place of "reveal", admins now use
  UserService.resetPassword to issue a one-time temporary password, which
  is why `mustChangePassword` is added below.

*/
-- AlterTable
ALTER TABLE "SuperAdmin"
    DROP COLUMN "plainPasswordEnc",
    ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User"
    DROP COLUMN "plainPasswordEnc",
    ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- F-14: lastDayOffResetYear no longer defaults to a hardcoded year. Existing
-- rows keep whatever value they already have (real data, not being
-- backfilled here); UserService.create now sets it explicitly for new rows.
ALTER TABLE "User" ALTER COLUMN "lastDayOffResetYear" DROP DEFAULT;
