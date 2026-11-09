-- A switch to turn off the high-risk confirmation (ROLES_PLAN.md §6.15): one
-- for every company, the Super Admin's, and one for each company, its
-- Admin's. Both on for every row, as the confirmation is today, so nothing
-- changes for anyone until somebody turns one off. Additive: two columns with
-- a default, nothing already saved is changed.
ALTER TABLE "SystemSettings" ADD COLUMN "confirmHighRisk" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Company" ADD COLUMN "confirmHighRisk" BOOLEAN NOT NULL DEFAULT true;
