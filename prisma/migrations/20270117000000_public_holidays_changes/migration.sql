-- Public holidays off for a company (FIRST_CHANGES_PLAN.md §6,
-- ATTENDANCE_PLAN.md §7.2, PR 362): each time a company turns the central
-- calendar of public holidays off, or back on, from a date. None means they
-- apply, as they always have. Only adds: a table, empty until a company
-- turns them off.
CREATE TABLE "PublicHolidaysChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "apply" BOOLEAN NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicHolidaysChange_pkey" PRIMARY KEY ("id")
);

-- One change a day for a company: the state on a date is the last change on
-- or before it.
CREATE UNIQUE INDEX "PublicHolidaysChange_companyId_effectiveFrom_key" ON "PublicHolidaysChange"("companyId", "effectiveFrom");

-- A company's go with it.
ALTER TABLE "PublicHolidaysChange" ADD CONSTRAINT "PublicHolidaysChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every table has Row Level Security on (DATABASE_SETUP.md).
ALTER TABLE "PublicHolidaysChange" ENABLE ROW LEVEL SECURITY;
