-- Step-up MFA for high-risk actions (ROLES_PLAN.md §6.15): how long a
-- confirmation lasts, in minutes.
ALTER TABLE "SystemSettings" ADD COLUMN "stepUpMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "SystemSettings" ADD CONSTRAINT "SystemSettings_stepUpMinutes_range" CHECK ("stepUpMinutes" BETWEEN 5 AND 480);
