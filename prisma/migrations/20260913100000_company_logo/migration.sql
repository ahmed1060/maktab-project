-- Per-company logo. Additive and nullable, so it is safe in a single deploy:
-- code that predates it simply never selects it, and every existing company
-- reads back as NULL, which is "no logo" rather than a missing one.
ALTER TABLE "Company" ADD COLUMN "logoUrl" TEXT;
