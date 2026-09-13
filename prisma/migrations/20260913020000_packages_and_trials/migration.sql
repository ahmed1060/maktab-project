-- Packages and trials. Structure only: nothing reads these to gate anything yet,
-- and every existing company is left grandfathered (packageId null, trialPreset
-- null), so this migration changes no behaviour for anybody.

CREATE TYPE "TrialPreset" AS ENUM ('TWO_DAYS', 'SEVEN_DAYS', 'FOURTEEN_DAYS', 'ONE_MONTH', 'THREE_MONTHS');

CREATE TABLE "Package" (
    "id"                   TEXT NOT NULL,
    "name"                 TEXT NOT NULL,
    "description"          TEXT,
    "isActive"             BOOLEAN NOT NULL DEFAULT true,
    "isPublic"             BOOLEAN NOT NULL DEFAULT true,
    "priceMonthly"         DECIMAL(12,2) NOT NULL DEFAULT 0,
    "priceAnnual"          DECIMAL(12,2) NOT NULL DEFAULT 0,
    "priceLifetime"        DECIMAL(12,2),
    "hasCompanyManagement" BOOLEAN NOT NULL DEFAULT false,
    "hasHR"                BOOLEAN NOT NULL DEFAULT false,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Package_name_key" ON "Package"("name");
CREATE INDEX "Package_isActive_idx" ON "Package"("isActive");

-- Every other table in this schema has RLS enabled with no policies (the
-- enable_rls_default_deny migration): the app connects as the table owner and
-- bypasses it, while anything reaching Postgres through PostgREST is denied by
-- default. A new table must match, or it is the one table reachable from
-- outside the application.
ALTER TABLE "Package" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Company" ADD COLUMN "packageId" TEXT;
ALTER TABLE "Company" ADD COLUMN "trialPreset" "TrialPreset";
ALTER TABLE "Company" ADD COLUMN "trialExtensionDays" INTEGER NOT NULL DEFAULT 0;

-- ON DELETE RESTRICT, not SET NULL. A package with companies on it must not be
-- deletable at all: null packageId means grandfathered in this design, so a
-- cascade to null would silently upgrade every affected paying customer to full
-- features. Packages are retired with isActive = false instead.
ALTER TABLE "Company"
    ADD CONSTRAINT "Company_packageId_fkey"
    FOREIGN KEY ("packageId") REFERENCES "Package"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX "Company_packageId_idx" ON "Company"("packageId");

-- Grace beyond the standard 48 hours, stored as the gift rather than as a
-- computed deadline.
ALTER TABLE "CompanyPayment" ADD COLUMN "graceExtensionHours" INTEGER NOT NULL DEFAULT 0;
