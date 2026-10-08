-- How many phones have acknowledged deleting the templates a purge made
-- unreadable, kept on the purge itself (review on #27). It was counted from
-- the wrapping-key rows, which go with their phone or person: deleting one
-- that had acknowledged lowered the count, and so did a phone given a new key
-- since. Filled in from those rows as they stand.
ALTER TABLE "FacePurge" ADD COLUMN "acknowledged" INTEGER NOT NULL DEFAULT 0;
UPDATE "FacePurge" p SET "acknowledged" = (
    SELECT count(*) FROM "FaceWrappingKey" k WHERE k."destroyedAt" = p."at" AND k."deleteAckAt" IS NOT NULL
);
