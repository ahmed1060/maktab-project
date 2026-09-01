/*
  F-13: User.role, User.status, Task.status, Task.paymentStatus,
  Obligation.recurrence, and DayOffRequest.type move from bare String to
  real Postgres enums. Zod already validates these on the API path, but
  nothing guarded a Prisma Studio edit, a seed script, or a manual SQL fix
  — a stray 'Pending' where the app expects 'PENDING' made a row invisible
  to every filter, with no error anywhere. An enum makes that a database-
  level constraint instead.

  Value sets were taken from actual usage (grepped across the codebase,
  cross-checked against each field's Zod schema), not assumed from the
  audit's own illustrative examples — Task.status here does NOT include a
  'SUBMITTED' value some enum-migration writeups use as an example,
  because this codebase never uses one; it uses PENDING_CONFIRMATION and
  COMPLETED instead, both very much present in the actual code.

  UPPER(TRIM(...)) below is a normalization pass, not a silent fix: every
  value in this app is written as an uppercase constant with no
  surrounding whitespace, so this only closes the gap for incidental case/
  whitespace drift. A value that doesn't match any label after that still
  fails the cast and aborts the migration — which is the point: better a
  blocked deploy than a silently corrupted status column. If this
  migration fails, the fix is to find the offending row(s) with something
  like `SELECT DISTINCT status FROM "Task" WHERE status NOT IN
  ('PENDING','IN_PROGRESS','PENDING_CONFIRMATION','APPROVED','REJECTED',
  'COMPLETED')`, decide what they should actually be, and either fix the
  data or extend the enum before retrying.
*/

CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'TEAM_LEADER', 'EMPLOYEE');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED', 'OFFLINE');
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'APPROVED', 'REJECTED', 'COMPLETED');
CREATE TYPE "TaskPaymentStatus" AS ENUM ('PENDING_PAYMENT', 'PAID');
CREATE TYPE "ObligationRecurrence" AS ENUM ('ONE_TIME', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');
CREATE TYPE "DayOffType" AS ENUM ('REGULAR', 'SICK', 'EMERGENCY', 'UNPAID');

-- AlterTable: User
ALTER TABLE "User"
    ALTER COLUMN "role" TYPE "UserRole" USING UPPER(TRIM("role"))::"UserRole",
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE "UserStatus" USING UPPER(TRIM("status"))::"UserStatus",
    ALTER COLUMN "status" SET DEFAULT 'OFFLINE';

-- AlterTable: Task
ALTER TABLE "Task"
    ALTER COLUMN "status" TYPE "TaskStatus" USING UPPER(TRIM("status"))::"TaskStatus",
    ALTER COLUMN "paymentStatus" DROP DEFAULT,
    ALTER COLUMN "paymentStatus" TYPE "TaskPaymentStatus" USING UPPER(TRIM("paymentStatus"))::"TaskPaymentStatus",
    ALTER COLUMN "paymentStatus" SET DEFAULT 'PENDING_PAYMENT';

-- AlterTable: Obligation
ALTER TABLE "Obligation"
    ALTER COLUMN "recurrence" DROP DEFAULT,
    ALTER COLUMN "recurrence" TYPE "ObligationRecurrence" USING UPPER(TRIM("recurrence"))::"ObligationRecurrence",
    ALTER COLUMN "recurrence" SET DEFAULT 'ONE_TIME';

-- AlterTable: DayOffRequest
ALTER TABLE "DayOffRequest"
    ALTER COLUMN "type" TYPE "DayOffType" USING UPPER(TRIM("type"))::"DayOffType";
