-- The attendance add-ons (ATTENDANCE_PLAN.md §16). Off on every existing
-- package, so no paying customer's access changes; grandfathered companies
-- (no package) receive attendance through the feature gate, not this row.

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "hasAttendanceMobile" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hasAttendanceTerminals" BOOLEAN NOT NULL DEFAULT false;

-- The rule the service enforces, held by the database too: neither add-on
-- without HR.
ALTER TABLE "Package" ADD CONSTRAINT "Package_attendance_requires_hr"
    CHECK ("hasHR" OR NOT ("hasAttendanceTerminals" OR "hasAttendanceMobile"));
