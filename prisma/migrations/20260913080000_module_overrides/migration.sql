-- E1, the expand step: per-company module names and icons.
--
-- Structure and a backfill only. Nothing reads these columns yet, so this
-- deploy changes nothing anybody can see. The migrate step points the reads at
-- them while still writing vendorsLabel, and only then does the contract step
-- drop that column.
--
-- Three deploys rather than one because vendorsLabel is seeded onto the session
-- JWT: renaming the field in a single deploy would make the Vendors label
-- vanish for every user holding a live token until it next refreshed.

ALTER TABLE "Company" ADD COLUMN "moduleLabels" JSONB;
ALTER TABLE "Company" ADD COLUMN "moduleIcons" JSONB;

-- Carry the one override that already exists. vendorsLabel is the half-built
-- version of this feature — a company could rename Vendors but not re-icon it —
-- so it is the thing being migrated from, not an example of the scope.
--
-- Only companies that actually set one: a null stays null rather than becoming
-- an empty object, so "has no overrides" and "has an empty map" do not become
-- two ways of saying the same thing.
UPDATE "Company"
SET "moduleLabels" = jsonb_build_object('vendors', "vendorsLabel")
WHERE "vendorsLabel" IS NOT NULL AND btrim("vendorsLabel") <> '';
