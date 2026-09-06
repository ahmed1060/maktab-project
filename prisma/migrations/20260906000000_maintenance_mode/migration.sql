-- System-wide maintenance mode: when on, non-super-admin users are held on
-- a holding page and their write requests are rejected (except one
-- emergency draft-save, reusing the same mechanism already built for
-- suspended/banned accounts). Super Admins are exempt so they can finish
-- whatever they're doing (e.g. a backup restore) before switching it off.
ALTER TABLE "SystemSettings" ADD COLUMN "maintenanceMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "maintenanceMessage" TEXT;
