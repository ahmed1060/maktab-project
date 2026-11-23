-- English and Arabic names (LATER_CHANGES_PLAN.md §3, step 1, PR 398): an
-- Arabic column beside each name, the one there today keeping the English.
-- Only adds: the columns, and a copy of each name written in Arabic until
-- today into its Arabic column, so nothing anyone sees changes. Every name
-- stays where it is; its Arabic letters say it has no English yet
-- (lib/names.ts).
ALTER TABLE "User" ADD COLUMN "firstNameAr" TEXT, ADD COLUMN "lastNameAr" TEXT;
ALTER TABLE "Client" ADD COLUMN "nameAr" TEXT, ADD COLUMN "ownerNameAr" TEXT;
ALTER TABLE "Company" ADD COLUMN "nameAr" TEXT;

-- Arabic letters, as lib/names.ts reads them: the Arabic block, its
-- supplement and extended letters, and the presentation forms. By their code
-- points, in a UTF-8 database, as production's and the development
-- database are.
UPDATE "User" SET "firstNameAr" = "firstName" WHERE "firstName" ~ '[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]';
UPDATE "User" SET "lastNameAr" = "lastName" WHERE "lastName" ~ '[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]';
UPDATE "Client" SET "nameAr" = "name" WHERE "name" ~ '[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]';
UPDATE "Client" SET "ownerNameAr" = "ownerName" WHERE "ownerName" ~ '[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]';
UPDATE "Company" SET "nameAr" = "name" WHERE "name" ~ '[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]';

-- An Arabic name is unique where its English one is: a client's in its
-- company, a company's across Nizmo. The copies come from names already
-- unique there.
CREATE UNIQUE INDEX "Client_nameAr_companyId_key" ON "Client"("nameAr", "companyId");
CREATE UNIQUE INDEX "Company_nameAr_key" ON "Company"("nameAr");
