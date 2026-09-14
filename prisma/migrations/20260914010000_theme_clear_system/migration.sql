-- The migrate half of retiring the "system" theme.
--
-- Nothing reads these rows as "system" any more: parseTheme stopped treating it
-- as a theme in the deploy before this one, so every one of these accounts has
-- already been rendering light. This is the stored value catching up with what
-- people are looking at, not a change to what they see.
--
-- Idempotent by its WHERE clause, and reversible by hand for as long as the
-- next step tolerates the value -- setting a row back to 'system' would simply
-- resolve to light again.
--
-- Two tables, because Super Admins live in their own.
UPDATE "User" SET "theme" = 'light' WHERE "theme" = 'system';
UPDATE "SuperAdmin" SET "theme" = 'light' WHERE "theme" = 'system';
