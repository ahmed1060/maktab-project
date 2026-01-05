-- AlterTable
ALTER TABLE "ClientNote" ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedById" TEXT;

-- AlterTable
ALTER TABLE "DayOffRequest" ADD COLUMN     "endDate" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
