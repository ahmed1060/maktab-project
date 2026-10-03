-- Face verification photos and their review (ATTENDANCE_PLAN.md §9.5).
CREATE TYPE "PhoneFaceStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "FaceReviewPurpose" AS ENUM ('ENROLMENT', 'REVERIFY');
CREATE TYPE "FaceReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

ALTER TABLE "CheckInPhone" ADD COLUMN "faceStatus" "PhoneFaceStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "CheckInPhone" ADD COLUMN "faceEnrolledAt" TIMESTAMP(3);
ALTER TABLE "CheckInPhone" ADD COLUMN "faceModelVersion" TEXT;
ALTER TABLE "User" ADD COLUMN "faceReverifyRequestedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "faceReverifyRequestedById" TEXT;

CREATE TABLE "FaceReview" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneId" TEXT NOT NULL,
    "purpose" "FaceReviewPurpose" NOT NULL,
    "status" "FaceReviewStatus" NOT NULL DEFAULT 'PENDING',
    "photo" BYTEA,
    "modelVersion" TEXT NOT NULL,
    "attested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedBySuperAdminId" TEXT,
    "reason" TEXT,
    CONSTRAINT "FaceReview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FaceReview_companyId_status_idx" ON "FaceReview"("companyId", "status");
CREATE INDEX "FaceReview_userId_status_idx" ON "FaceReview"("userId", "status");
ALTER TABLE "FaceReview" ADD CONSTRAINT "FaceReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FaceReview" ADD CONSTRAINT "FaceReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one photo waiting per person, and at most one reference photo.
CREATE UNIQUE INDEX "FaceReview_one_pending" ON "FaceReview"("userId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "FaceReview_one_reference" ON "FaceReview"("userId") WHERE "status" = 'APPROVED' AND "photo" IS NOT NULL;
-- A photo exists only while it is waiting or is the reference: rejected and withdrawn ones are deleted.
ALTER TABLE "FaceReview" ADD CONSTRAINT "FaceReview_photo_only_while_kept" CHECK ("photo" IS NULL OR "status" IN ('PENDING', 'APPROVED'));
