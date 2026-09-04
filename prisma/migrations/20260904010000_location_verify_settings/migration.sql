-- Company Settings: whether task-location auto-verify runs at all for
-- this company's tasks. Defaults true so existing behavior is unchanged
-- for every company until an admin opts theirs out.
ALTER TABLE "Company" ADD COLUMN "autoVerifyLocation" BOOLEAN NOT NULL DEFAULT true;

-- System Settings: single-row table for platform-wide configuration,
-- starting with the auto-verify distance threshold (was hardcoded to
-- 100m in task.service.ts; now configurable, defaulting to 70m).
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "locationVerifyRadiusMeters" INTEGER NOT NULL DEFAULT 70,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- Seed the one row this table is meant to ever hold.
INSERT INTO "SystemSettings" ("id", "locationVerifyRadiusMeters", "updatedAt")
VALUES ('default', 70, now());
