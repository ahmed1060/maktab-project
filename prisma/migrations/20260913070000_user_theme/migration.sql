-- Theme preference, on both account tables — a Super Admin gets a dark mode
-- too, and their accounts live in a separate table from Users.
--
-- Three states, not a boolean: "system" means follow the operating system,
-- which is what most people want and what every app they already use does. A
-- boolean cannot express it, and defaulting anyone to an explicit choice they
-- never made would override the preference their OS already carries.
--
-- Defaults to system, so nobody's appearance changes until they pick.
ALTER TABLE "User" ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "SuperAdmin" ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'system';
