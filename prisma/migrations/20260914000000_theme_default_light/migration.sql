-- The expand half of retiring the "system" theme.
--
-- Only the defaults move, so a row created from here on is light. Existing
-- rows keep whatever they say, including "system", which parseTheme folds into
-- the default on read — nothing in the application branches on it any more.
-- The migrate step clears those rows; the contract step stops tolerating the
-- value at all.
--
-- Two tables, because Super Admins live in their own. Fixing one and missing
-- the other is the easy mistake here.
ALTER TABLE "User" ALTER COLUMN "theme" SET DEFAULT 'light';
ALTER TABLE "SuperAdmin" ALTER COLUMN "theme" SET DEFAULT 'light';
