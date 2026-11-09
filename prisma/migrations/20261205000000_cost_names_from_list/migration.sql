-- Cost names only from the saved list (CLIENTS_PLAN.md §6.9): a company
-- setting, off for every company until its Admin switches it on. Additive:
-- a column every row starts without, so nothing already saved changes.
ALTER TABLE "Company" ADD COLUMN "costNamesFromListOnly" BOOLEAN NOT NULL DEFAULT false;
