-- The brand colour (UI_PLAN.md §4.6). The default, which the sign-in page,
-- the Super Admin's pages and every company without its own use, starts as
-- Nizmo's own indigo. A company's own is null until it chooses one. Both are
-- added with defaults, so main's code is unaffected when a preview build
-- migrates the shared database.
ALTER TABLE "SystemSettings" ADD COLUMN "brandColour" TEXT NOT NULL DEFAULT '#6366f1';
ALTER TABLE "SystemSettings" ADD CONSTRAINT "SystemSettings_brandColour_hex" CHECK ("brandColour" ~ '^#[0-9a-f]{6}$');
ALTER TABLE "Company" ADD COLUMN "brandColour" TEXT;
ALTER TABLE "Company" ADD CONSTRAINT "Company_brandColour_hex" CHECK ("brandColour" IS NULL OR "brandColour" ~ '^#[0-9a-f]{6}$');
