-- AlterTable
ALTER TABLE "ClientNote" ADD COLUMN     "attachment" TEXT,
ADD COLUMN     "expiryDate" TIMESTAMP(3),
ADD COLUMN     "notifiedDaysBefore" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifiedOnExpiry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reminderDays" INTEGER;
