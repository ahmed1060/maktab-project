-- A company's spellings of its names (LATER_CHANGES_PLAN.md §3.1, step 3a,
-- PR 400): each word of a name saved in both languages, in Arabic beside its
-- English, where it was saved, and how many names use it. Worked out again
-- from the names themselves whenever one is saved
-- (lib/services/name-spelling.service.ts). Only adds: a table, empty until
-- a name is saved in both languages.
CREATE TABLE "NameSpelling" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ar" TEXT NOT NULL,
    "arKey" TEXT NOT NULL,
    "en" TEXT NOT NULL,
    "enKey" TEXT NOT NULL,
    "uses" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NameSpelling_pkey" PRIMARY KEY ("id")
);

-- Each spelling once for each company and where it was saved, looked up by
-- either language.
CREATE UNIQUE INDEX "NameSpelling_companyId_source_arKey_enKey_key" ON "NameSpelling"("companyId", "source", "arKey", "enKey");
CREATE INDEX "NameSpelling_companyId_arKey_idx" ON "NameSpelling"("companyId", "arKey");
CREATE INDEX "NameSpelling_companyId_enKey_idx" ON "NameSpelling"("companyId", "enKey");

-- A company's go with it.
ALTER TABLE "NameSpelling" ADD CONSTRAINT "NameSpelling_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What the schema can't say: where a spelling was saved, and that one no
-- name uses isn't kept.
ALTER TABLE "NameSpelling" ADD CONSTRAINT "NameSpelling_source" CHECK ("source" IN ('employee', 'client', 'owner', 'company'));
ALTER TABLE "NameSpelling" ADD CONSTRAINT "NameSpelling_uses" CHECK ("uses" > 0);

-- Every table has Row Level Security on (DATABASE_SETUP.md).
ALTER TABLE "NameSpelling" ENABLE ROW LEVEL SECURITY;
