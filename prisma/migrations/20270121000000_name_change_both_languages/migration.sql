-- A request to change one's own name, in both languages (LATER_CHANGES_PLAN.md
-- §3.1, step 4c, PR 404): each name asked for in Arabic beside its English,
-- and the ones it's from. Only adds: four columns, empty for a request asked
-- before, which is approved as PR 398 did.
ALTER TABLE "ProfileUpdateRequest"
    ADD COLUMN "oldFirstNameAr" TEXT,
    ADD COLUMN "oldLastNameAr" TEXT,
    ADD COLUMN "newFirstNameAr" TEXT,
    ADD COLUMN "newLastNameAr" TEXT;
