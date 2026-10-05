-- Permanently deleting a person removes their punches with them (review on
-- #12). Setting userId to null instead left a hand-added punch with neither a
-- person nor a terminal number, which AttendancePunch_has_someone refuses, so
-- the deletion itself failed. A permanent deletion is a purge: their employee
-- numbers and attendance days go with them too.

ALTER TABLE "AttendancePunch" DROP CONSTRAINT "AttendancePunch_userId_fkey";
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
