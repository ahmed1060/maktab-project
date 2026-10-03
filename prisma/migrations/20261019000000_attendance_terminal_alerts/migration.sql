-- Silent terminals raise a notification that stays until they are heard
-- again (ATTENDANCE_PLAN.md §13.4).
CREATE TYPE "NotificationPriority" AS ENUM ('NORMAL', 'HIGH', 'CRITICAL');

ALTER TABLE "Notification" ADD COLUMN "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL';

ALTER TABLE "AttendanceAgent" ADD COLUMN "alertedAt" TIMESTAMP(3);
ALTER TABLE "AttendanceDevice" ADD COLUMN "alertedAt" TIMESTAMP(3);
