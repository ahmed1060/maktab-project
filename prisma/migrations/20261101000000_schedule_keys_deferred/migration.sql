-- A schedule somebody is on, or that is a default, still can't be deleted on
-- its own, but the check now runs at commit (review on #64). Checked at once
-- (RESTRICT), deleting a company could fail: the company's cascade to its
-- schedules and its cascade to its people, whose assignments go with them,
-- run in the order their trigger names sort, and with the schedules first an
-- assignment still pointed at one. Which order a database has depends on the
-- constraints' object ids; a deferred check doesn't.

ALTER TABLE "UserSchedule" DROP CONSTRAINT "UserSchedule_scheduleId_fkey",
    ADD CONSTRAINT "UserSchedule_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "ScheduleDefault" DROP CONSTRAINT "ScheduleDefault_scheduleId_fkey",
    ADD CONSTRAINT "ScheduleDefault_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
