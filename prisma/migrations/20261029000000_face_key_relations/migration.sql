-- A phone's wrapping key goes with its phone and its owner (review on #27).
-- Deleting a company cascades straight through its people and phones without
-- the status triggers ever running, which left their keys behind for good.
DELETE FROM "FaceWrappingKey" k WHERE NOT EXISTS (SELECT 1 FROM "CheckInPhone" p WHERE p.id = k."phoneId")
    OR NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = k."userId");
ALTER TABLE "FaceWrappingKey" ADD CONSTRAINT "FaceWrappingKey_phoneId_fkey" FOREIGN KEY ("phoneId") REFERENCES "CheckInPhone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FaceWrappingKey" ADD CONSTRAINT "FaceWrappingKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
