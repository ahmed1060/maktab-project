-- Live updates, part 4c (REALTIME_PLAN.md): the database says when a
-- company's attendance changes, so the lists that show it draw themselves
-- again: the Attendance page's Exceptions, Days and Punches tabs, and the
-- Super Admin's Check-ins page.
--
-- Only adds things: one function, the triggers that call it, and one rule
-- on Supabase's realtime.messages. No row is read or changed by it, and
-- nothing anyone does today works differently.
--
-- As the other parts' signals, it says only that something changed, never
-- what: its event is 'changed' and its payload empty. Not who checked in.
-- It goes on a channel of its own for each company, attendance:<company
-- id>, which a tab joins only while one of those lists is open, as who's
-- online's is (part 6b). A company of 200 makes about 400 check-ins a
-- working day: on the company's channel (tasks:<company id>), every open
-- tab of the company would hear each.
--
-- Once per statement for each company it touched:
--   - a punch added, by a check-in, by hand or from a file, withdrawn, its
--     flag decided, or gone;
--   - a day worked out, or worked out again with other figures, or gone.
--     Not one worked out again with the same figures: the nightly run works
--     out whole months again, and only the time it did so changes
--     ("derivedAt");
--   - a decision on a day's exception made, changed or undone;
--   - a check-in refused, which the Super Admin's Check-ins page counts.
-- An update that changed nothing sends nothing.

CREATE OR REPLACE FUNCTION live_attendance_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    companies text[];
    company text;
BEGIN
    -- As the other parts' triggers, each branch reads only the transition
    -- tables its event has; a branch not taken is never planned.
    IF TG_OP = 'INSERT' THEN
        companies := array(SELECT "companyId" FROM live_new);
    ELSIF TG_OP = 'DELETE' THEN
        companies := array(SELECT "companyId" FROM live_old);
    ELSE
        -- A row compared whole, but for when its day was last worked out.
        companies := array(
            SELECT n."companyId" FROM live_new n JOIN live_old o ON o.id = n.id
            WHERE to_jsonb(n) - 'derivedAt' IS DISTINCT FROM to_jsonb(o) - 'derivedAt'
            UNION
            SELECT o."companyId" FROM live_new n JOIN live_old o ON o.id = n.id
            WHERE n."companyId" IS DISTINCT FROM o."companyId"
        );
    END IF;
    FOR company IN SELECT DISTINCT c FROM unnest(companies) c WHERE c IS NOT NULL ORDER BY 1 LOOP
        PERFORM live_signal('attendance:' || company);
    END LOOP;
    RETURN NULL;
END
$$;

-- One trigger for each event on each table, as the other parts': a trigger
-- with transition tables handles one event, and none may name its columns.
-- A refusal is only ever added.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['AttendancePunch', 'AttendanceDay', 'AttendanceDayDecision'] LOOP
        EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_attendance_changed()',
            'live_attendance_' || t || '_inserted', t);
        EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING OLD TABLE AS live_old NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_attendance_changed()',
            'live_attendance_' || t || '_updated', t);
        EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS live_old FOR EACH STATEMENT EXECUTE FUNCTION live_attendance_changed()',
            'live_attendance_' || t || '_deleted', t);
    END LOOP;
END
$$;
CREATE TRIGGER "live_attendance_CheckInRefusal_inserted" AFTER INSERT ON "CheckInRefusal"
    REFERENCING NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_attendance_changed();

-- Who may listen: a company's people who may see other people's attendance,
-- their own company's channel only; and the Super Admin, any company's. The
-- rule can't read the app's permissions, so the app's token says whether its
-- person may (sees_attendance, app/api/realtime/token/route.ts). Broadcasts
-- only, and only to read, as part 1's rule.
DO $$
BEGIN
    IF to_regclass('realtime.messages') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE $policy$
            CREATE POLICY "Live updates: attendance, to those who see others'"
            ON realtime.messages FOR SELECT TO authenticated
            USING (
                realtime.messages.extension = 'broadcast'
                AND (
                    (
                        ((SELECT auth.jwt()) ->> 'sees_attendance') = 'true'
                        AND (SELECT realtime.topic()) = 'attendance:' || ((SELECT auth.jwt()) ->> 'company_id')
                    )
                    OR (
                        ((SELECT auth.jwt()) ->> 'super_admin') = 'true'
                        AND (SELECT realtime.topic()) ~ '^attendance:[^:]+$'
                    )
                )
            )
        $policy$;
    END IF;
END
$$;
