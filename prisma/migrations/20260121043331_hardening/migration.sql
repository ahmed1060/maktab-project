/*
  Warnings:

  - A unique constraint covering the columns `[username]` on the table `SuperAdmin` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[username]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `createdById` to the `Client` table without a default value. This is not possible if the table is not empty.
  - Made the column `createdById` on table `ClientNote` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `createdById` to the `ClientSection` table without a default value. This is not possible if the table is not empty.
  - Added the required column `username` to the `SuperAdmin` table without a default value. This is not possible if the table is not empty.
  - Made the column `createdBy` on table `Task` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `username` to the `User` table without a default value. This is not possible if the table is not empty.
  - Made the column `salary` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "ClientNote" DROP CONSTRAINT "ClientNote_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_createdBy_fkey";

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "lastEditedById" TEXT;

-- AlterTable
ALTER TABLE "ClientNote" ALTER COLUMN "createdById" SET NOT NULL;

-- AlterTable
ALTER TABLE "ClientSection" ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "lastEditedById" TEXT;

-- AlterTable
ALTER TABLE "DayOffRequest" ADD COLUMN     "deductionType" TEXT NOT NULL DEFAULT 'CREDIT';

-- AlterTable
ALTER TABLE "SuperAdmin" ADD COLUMN     "plainPasswordEnc" TEXT,
ADD COLUMN     "username" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "memberCosts" TEXT,
ADD COLUMN     "memberPaymentStatus" TEXT,
ALTER COLUMN "createdBy" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "baseDayOffCredit" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "lastDayOffResetYear" INTEGER NOT NULL DEFAULT 2026,
ADD COLUMN     "plainPasswordEnc" TEXT,
ADD COLUMN     "username" TEXT NOT NULL,
ALTER COLUMN "salary" SET NOT NULL;

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "inProgressAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayOffCreditSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "baseCredit" DOUBLE PRECISION NOT NULL,
    "remainingCredit" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayOffCreditSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_MultipleAssignees" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "Request_userId_idx" ON "Request"("userId");

-- CreateIndex
CREATE INDEX "Request_companyId_idx" ON "Request"("companyId");

-- CreateIndex
CREATE INDEX "Request_status_idx" ON "Request"("status");

-- CreateIndex
CREATE INDEX "DayOffCreditSnapshot_userId_idx" ON "DayOffCreditSnapshot"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DayOffCreditSnapshot_userId_year_key" ON "DayOffCreditSnapshot"("userId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "_MultipleAssignees_AB_unique" ON "_MultipleAssignees"("A", "B");

-- CreateIndex
CREATE INDEX "_MultipleAssignees_B_index" ON "_MultipleAssignees"("B");

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdmin_username_key" ON "SuperAdmin"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSection" ADD CONSTRAINT "ClientSection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSection" ADD CONSTRAINT "ClientSection_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayOffCreditSnapshot" ADD CONSTRAINT "DayOffCreditSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MultipleAssignees" ADD CONSTRAINT "_MultipleAssignees_A_fkey" FOREIGN KEY ("A") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MultipleAssignees" ADD CONSTRAINT "_MultipleAssignees_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
