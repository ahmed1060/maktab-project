-- Periodic access review (ROLES_PLAN.md §6.14), per company, off by default.

-- CreateEnum
CREATE TYPE "AccessReviewStatus" AS ENUM ('OPEN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AccessReviewDecision" AS ENUM ('CONFIRMED', 'CHANGE_REQUESTED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "accessReviewEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "accessReviewMonths" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "accessReviewNextAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AccessReview" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "AccessReviewStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AccessReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessReviewLine" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "decision" "AccessReviewDecision",
    "note" TEXT,
    "answeredById" TEXT,
    "answeredBySuperAdminId" TEXT,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "AccessReviewLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessReview_companyId_status_idx" ON "AccessReview"("companyId", "status");

-- CreateIndex
CREATE INDEX "AccessReview_status_idx" ON "AccessReview"("status");

-- CreateIndex
CREATE INDEX "AccessReviewLine_reviewId_idx" ON "AccessReviewLine"("reviewId");

-- AddForeignKey
ALTER TABLE "AccessReview" ADD CONSTRAINT "AccessReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewLine" ADD CONSTRAINT "AccessReviewLine_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "AccessReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewLine" ADD CONSTRAINT "AccessReviewLine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewLine" ADD CONSTRAINT "AccessReviewLine_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewLine" ADD CONSTRAINT "AccessReviewLine_answeredBySuperAdminId_fkey" FOREIGN KEY ("answeredBySuperAdminId") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "Company" ADD CONSTRAINT "Company_accessReviewMonths_range" CHECK ("accessReviewMonths" BETWEEN 1 AND 12);
