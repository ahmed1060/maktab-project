-- Face verification: the phone's wrapping key (crypto-shredding), the flagged
-- check-in frame, and the purge record (ATTENDANCE_PLAN.md §10.4, §13.8).
CREATE TABLE "FaceWrappingKey" (
    "id" TEXT NOT NULL,
    "phoneId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "destroyedAt" TIMESTAMP(3),
    "deleteAckAt" TIMESTAMP(3),
    CONSTRAINT "FaceWrappingKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FaceWrappingKey_phoneId_key" ON "FaceWrappingKey"("phoneId");
CREATE INDEX "FaceWrappingKey_userId_idx" ON "FaceWrappingKey"("userId");
-- Once destroyed, never back: a destroyed row can't get a key again.
ALTER TABLE "FaceWrappingKey" ADD CONSTRAINT "FaceWrappingKey_destroyed_is_gone" CHECK ("destroyedAt" IS NULL OR "key" IS NULL);

CREATE TABLE "FaceFrame" (
    "id" TEXT NOT NULL,
    "punchId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "photo" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FaceFrame_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FaceFrame_punchId_key" ON "FaceFrame"("punchId");
ALTER TABLE "FaceFrame" ADD CONSTRAINT "FaceFrame_punchId_fkey" FOREIGN KEY ("punchId") REFERENCES "AttendancePunch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FacePurge" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bySuperAdminId" TEXT NOT NULL,
    "keysDestroyed" INTEGER NOT NULL,
    "photosDeleted" INTEGER NOT NULL,
    CONSTRAINT "FacePurge_pkey" PRIMARY KEY ("id")
);

-- A phone that leaves use, or whose owner is archived or deleted, loses its
-- wrapping key at that instant, whichever code path did it.
CREATE FUNCTION face_destroy_phone_key() RETURNS trigger AS $$
BEGIN
    IF OLD."status" = 'ACTIVE' AND NEW."status" <> 'ACTIVE' THEN
        UPDATE "FaceWrappingKey" SET "key" = NULL, "destroyedAt" = COALESCE("destroyedAt", now()) WHERE "phoneId" = NEW."id";
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "CheckInPhone_face_key" AFTER UPDATE OF "status" ON "CheckInPhone" FOR EACH ROW EXECUTE FUNCTION face_destroy_phone_key();

CREATE FUNCTION face_destroy_user_keys() RETURNS trigger AS $$
BEGIN
    IF NEW."status" IN ('ARCHIVED', 'DELETED') AND OLD."status" IS DISTINCT FROM NEW."status" THEN
        UPDATE "FaceWrappingKey" SET "key" = NULL, "destroyedAt" = COALESCE("destroyedAt", now()) WHERE "userId" = NEW."id";
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "User_face_keys" AFTER UPDATE OF "status" ON "User" FOR EACH ROW EXECUTE FUNCTION face_destroy_user_keys();
