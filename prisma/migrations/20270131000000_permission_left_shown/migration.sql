-- Whether each person sees what's left of their own permission hours
-- (LATER_CHANGES_PLAN.md §7.18): a company's one switch, on unless it turns
-- it off, so nothing changes for any company until then. Only adds.
ALTER TABLE "Company" ADD COLUMN "permissionLeftShown" BOOLEAN NOT NULL DEFAULT true;
