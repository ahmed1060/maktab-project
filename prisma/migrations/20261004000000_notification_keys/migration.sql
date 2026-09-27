-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "messageKey" TEXT,
ADD COLUMN     "messageParams" JSONB;
