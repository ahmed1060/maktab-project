-- The contract step for per-company module names.
--
-- 20260913080000_module_overrides copied every company's "vendorsLabel" into
-- "moduleLabels"->>'vendors', and the deploy before this one removed every read
-- and write of the column, including the Prisma field -- so nothing has
-- selected it since. This drops it.
--
-- The constraint below is a guard, not a constraint anybody keeps: DROP COLUMN
-- takes it straight back out again on the next statement. It is here because
-- ADD CONSTRAINT validates every existing row, so if any company still holds a
-- label that "moduleLabels" does not carry -- the backfill missing a row, or
-- somebody setting one through an older deploy in the window between the two --
-- this migration fails and the column survives.
--
-- That matters because of when this runs. DROP COLUMN is not undone by rolling
-- back the deploy that ran it, and migrations run during a build, with nobody
-- watching. A failed build is recoverable; a customer's rename is not.
--
-- Written as plain DDL rather than a DO block with a RAISE: no other migration
-- here uses dollar-quoting, and how Prisma's engine splits a migration file
-- around $$ has varied by version. A CHECK says the same thing in SQL this
-- repo has already proved it can run.
--
-- IS NOT DISTINCT FROM, not "=". The case this guard exists for is a company
-- holding a label the map has no key for at all, and "=" against a missing key
-- is NULL rather than false -- which a CHECK treats as satisfied. Written with
-- "=" the guard passes on precisely the row it was built to stop. Found by
-- running it against a copy of the production table with such a row planted in
-- it, and watching it not fire.
ALTER TABLE "Company"
    ADD CONSTRAINT "Company_vendorsLabel_backfilled_check"
    CHECK (
        "vendorsLabel" IS NULL
        OR btrim("vendorsLabel") = ''
        OR "moduleLabels"->>'vendors' IS NOT DISTINCT FROM "vendorsLabel"
    );

ALTER TABLE "Company" DROP COLUMN "vendorsLabel";
