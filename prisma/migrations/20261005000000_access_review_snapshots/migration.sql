-- An access review is kept as evidence (ROLES_PLAN.md §6.14), so each line
-- keeps what was reviewed: the person's name, and the role it came through.
-- Deleting the person or the role clears the link and keeps the line.

ALTER TABLE "AccessReviewLine" DROP CONSTRAINT "AccessReviewLine_userId_fkey";

ALTER TABLE "AccessReviewLine" ADD COLUMN "userName" TEXT,
ADD COLUMN "roleId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- Lines written before this: the name from the person's row, the role by
-- its name in the review's company (a company's role names are unique).
UPDATE "AccessReviewLine" l SET "userName" = trim(u."firstName" || ' ' || u."lastName")
FROM "User" u WHERE u."id" = l."userId";
UPDATE "AccessReviewLine" l SET "roleId" = r."id"
FROM "AccessReview" ar, "Role" r
WHERE ar."id" = l."reviewId" AND r."companyId" = ar."companyId" AND r."name" = l."roleName";
UPDATE "AccessReviewLine" SET "userName" = '' WHERE "userName" IS NULL;

ALTER TABLE "AccessReviewLine" ALTER COLUMN "userName" SET NOT NULL;

ALTER TABLE "AccessReviewLine" ADD CONSTRAINT "AccessReviewLine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccessReviewLine" ADD CONSTRAINT "AccessReviewLine_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
