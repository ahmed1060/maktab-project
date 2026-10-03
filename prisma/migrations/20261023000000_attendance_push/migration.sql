-- Push notifications to the check-in app (ATTENDANCE_PLAN.md §13.4).
ALTER TABLE "CheckInPhone" ADD COLUMN "pushToken" TEXT;
ALTER TABLE "CheckInPhone" ADD COLUMN "pushTokenAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "pushedAt" TIMESTAMP(3);
-- The outbox: recent notifications not yet pushed.
CREATE INDEX "Notification_pushedAt_createdAt_idx" ON "Notification"("createdAt") WHERE "pushedAt" IS NULL;

-- The no-check-in reminder, once per person and working day.
CREATE TABLE "CheckInReminder" (
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "companyId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckInReminder_pkey" PRIMARY KEY ("userId", "date")
);
CREATE INDEX "CheckInReminder_companyId_idx" ON "CheckInReminder"("companyId");
ALTER TABLE "CheckInReminder" ADD CONSTRAINT "CheckInReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckInReminder" ADD CONSTRAINT "CheckInReminder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
