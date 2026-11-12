-- Live updates, part 4c (REALTIME_PLAN.md), found by Codex on PR 265: the
-- Super Admin's Check-ins page lists, and hears the channels of, only the
-- companies that checked in or were refused in the last 30 days. One doing
-- so for the first time in 30 days had nothing to say so: the page heard no
-- channel of its. Now it says so on each Super Admin's own channel
-- (notices:<id>), with 'attendance', as empty as the other signals, and the
-- page draws itself again, lists it and hears its channel from then on.
--
-- Only adds things: one index, one function and the two triggers that call
-- it. No row is read or changed by it, and nothing anyone does today works
-- differently.
--
-- Rare: once for a company coming back to checking in after 30 days or
-- more, or starting to. Its check-ins after that go on its own channel, as
-- part 4c's do.

-- A company's check-ins from the phone app by when they came in, as the
-- Check-ins page counts them: whether one came in the last 30 days is one
-- step, on every check-in, however long the company's history.
CREATE INDEX "AttendancePunch_companyId_source_receivedAt_idx" ON "AttendancePunch"("companyId", source, "receivedAt");

CREATE OR REPLACE FUNCTION live_attendance_found() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    -- As the Check-ins page counts: when each came in, as stored.
    since timestamp := LOCALTIMESTAMP - interval '30 days';
    companies text[];
    fresh text[];
BEGIN
    -- What this statement added that the page counts. As the other parts'
    -- triggers, each branch reads only the columns its table has.
    IF TG_TABLE_NAME = 'AttendancePunch' THEN
        SELECT array_agg(DISTINCT "companyId"), array_agg(id) INTO companies, fresh
        FROM live_new WHERE source = 'MOBILE' AND "receivedAt" >= since;
    ELSE
        SELECT array_agg(DISTINCT "companyId"), array_agg(id) INTO companies, fresh
        FROM live_new WHERE at >= since;
    END IF;
    -- Once for the statement, however many companies it found: the signal
    -- says only that the page has something new to list.
    IF EXISTS (
        SELECT 1 FROM unnest(companies) AS c(company)
        WHERE NOT EXISTS (
            SELECT 1 FROM "AttendancePunch" p
            WHERE p."companyId" = c.company AND p.source = 'MOBILE' AND p."receivedAt" >= since
              AND NOT (TG_TABLE_NAME = 'AttendancePunch' AND p.id = ANY (fresh))
        ) AND NOT EXISTS (
            SELECT 1 FROM "CheckInRefusal" r
            WHERE r."companyId" = c.company AND r.at >= since
              AND NOT (TG_TABLE_NAME = 'CheckInRefusal' AND r.id = ANY (fresh))
        )
    ) THEN
        PERFORM live_super_admin_signal('attendance');
    END IF;
    RETURN NULL;
END
$$;

CREATE TRIGGER "live_attendance_found_AttendancePunch" AFTER INSERT ON "AttendancePunch"
    REFERENCING NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_attendance_found();
CREATE TRIGGER "live_attendance_found_CheckInRefusal" AFTER INSERT ON "CheckInRefusal"
    REFERENCING NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_attendance_found();
