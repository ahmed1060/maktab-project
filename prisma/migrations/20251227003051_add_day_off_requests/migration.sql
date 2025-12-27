-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dayOffCredit" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DayOffRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayOffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DayOffRequest_userId_idx" ON "DayOffRequest"("userId");

-- CreateIndex
CREATE INDEX "DayOffRequest_status_idx" ON "DayOffRequest"("status");

-- AddForeignKey
ALTER TABLE "DayOffRequest" ADD CONSTRAINT "DayOffRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
