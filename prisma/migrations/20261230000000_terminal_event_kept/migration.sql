-- What a scan keeps of its event, and a terminal's own time zone
-- (ATTENDANCE_PLAN.md §17.5, Phase 4 part 5, PR 293). Only adds: both
-- columns are empty for every row there is.

-- The fields of the event a terminal sent with a scan that Nizmo knows: when
-- and what kind it was, the terminal, the employee number, how the person
-- was identified. Never a name, a card's number or a picture.
ALTER TABLE "AttendancePunch" ADD COLUMN "rawPayload" JSONB;

-- A terminal's own offset from UTC, in minutes, as the last scan it sent
-- itself stated it. Empty until it sends one.
ALTER TABLE "AttendanceDevice" ADD COLUMN "utcOffsetMinutes" INTEGER;
