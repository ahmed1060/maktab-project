-- Live updates, part 2 (REALTIME_PLAN.md): the database says when a
-- company's requests change, so the Requests page and the count on Requests
-- in the side bar draw themselves again, as the task list does.
--
-- Only adds things: functions and the triggers that call them. No row is read
-- or changed by it, and nothing anyone does today works differently.
--
-- As part 1's signals, it says only that something changed, never what: its
-- event is 'requests' and its payload empty. It goes on the channel part 1
-- already lets a company's people hear (tasks:<company id>), and on each Super
-- Admin's own (notices:<id>): with no company in view, their Requests page
-- and count are every company's (lib/requests/feed.ts, waitingForReview), and
-- they hear no company's channel then. One per statement for each company it
-- touched, and one for each Super Admin.
--
-- Every kind on the Requests page is covered, from the table it's read from:
--   - internal requests ("Request"), permission hours ("PermissionRequest"),
--     missing punches ("MissingPunchRequest"), overtime decisions
--     ("OvertimeApproval") and role requests ("RoleRequest"), which carry
--     their company: any change;
--   - day off ("DayOffRequest") and name changes ("ProfileUpdateRequest"),
--     which carry only their person: any change, for the person's company;
--   - overtime waiting ("AttendanceDay"), flagged check-ins
--     ("AttendancePunch") and check-in phones ("CheckInPhone"): only the rows
--     a request is made of. These change far more often than their requests
--     do (a check-in writes a punch, works its day out again, and counts on
--     its phone), and a signal for each would draw every open Requests page
--     and count in the company with every check-in.

-- A statement's companies, and every Super Admin.
CREATE OR REPLACE FUNCTION live_requests_signal(companies text[]) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    company text;
    admin text;
    touched boolean := false;
BEGIN
    FOR company IN SELECT DISTINCT c FROM unnest(companies) c WHERE c IS NOT NULL ORDER BY 1 LOOP
        PERFORM live_signal('tasks:' || company, 'requests');
        touched := true;
    END LOOP;
    IF touched THEN
        FOR admin IN SELECT id FROM "SuperAdmin" ORDER BY 1 LOOP
            PERFORM live_signal('notices:' || admin, 'requests');
        END LOOP;
    END IF;
END
$$;

-- As part 1's triggers, each function reads only the transition table its
-- event has; a branch not taken is never planned, so the other is never
-- looked for.

-- A request that carries its company: every company a statement's rows were
-- in, before or after.
CREATE OR REPLACE FUNCTION live_requests_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM live_requests_signal(array(SELECT "companyId" FROM live_new));
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM live_requests_signal(array(SELECT "companyId" FROM live_old));
    ELSE
        PERFORM live_requests_signal(array(SELECT "companyId" FROM live_new UNION SELECT "companyId" FROM live_old));
    END IF;
    RETURN NULL;
END
$$;

-- A request that carries only its person: their company. A row deleted with
-- its person has no company left to tell.
CREATE OR REPLACE FUNCTION live_person_requests_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM live_requests_signal(array(SELECT u."companyId" FROM live_new r JOIN "User" u ON u.id = r."userId"));
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM live_requests_signal(array(SELECT u."companyId" FROM live_old r JOIN "User" u ON u.id = r."userId"));
    ELSE
        PERFORM live_requests_signal(array(
            SELECT u."companyId" FROM (SELECT "userId" FROM live_new UNION SELECT "userId" FROM live_old) r JOIN "User" u ON u.id = r."userId"
        ));
    END IF;
    RETURN NULL;
END
$$;

-- A day's overtime: waiting, decided, or what the waiting row shows (its
-- minutes, first in and last out) worked out again.
CREATE OR REPLACE FUNCTION live_overtime_days_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM live_requests_signal(array(SELECT "companyId" FROM live_new WHERE "overtimeStatus" = 'PENDING'));
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM live_requests_signal(array(SELECT "companyId" FROM live_old WHERE "overtimeStatus" = 'PENDING'));
    ELSE
        PERFORM live_requests_signal(array(
            SELECT n."companyId" FROM live_new n JOIN live_old o ON o.id = n.id
            WHERE n."overtimeStatus" IS DISTINCT FROM o."overtimeStatus"
               OR (n."overtimeStatus" = 'PENDING'
                   AND (n."overtimeMinutes", n."firstInAt", n."lastOutAt") IS DISTINCT FROM (o."overtimeMinutes", o."firstInAt", o."lastOutAt"))
        ));
    END IF;
    RETURN NULL;
END
$$;

-- A check-in flagged, reviewed, or withdrawn while flagged or reviewed.
CREATE OR REPLACE FUNCTION live_flagged_punches_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM live_requests_signal(array(SELECT "companyId" FROM live_new WHERE status = 'FLAGGED'));
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM live_requests_signal(array(SELECT "companyId" FROM live_old WHERE status = 'FLAGGED' OR "reviewedAt" IS NOT NULL));
    ELSE
        PERFORM live_requests_signal(array(
            SELECT n."companyId" FROM live_new n JOIN live_old o ON o.id = n.id
            WHERE (n.status, n."reviewedAt", n."voidedAt") IS DISTINCT FROM (o.status, o."reviewedAt", o."voidedAt")
              AND (n.status = 'FLAGGED' OR o.status = 'FLAGGED' OR n."reviewedAt" IS NOT NULL OR o."reviewedAt" IS NOT NULL)
        ));
    END IF;
    RETURN NULL;
END
$$;

-- A check-in phone asked for, or its status decided.
CREATE OR REPLACE FUNCTION live_phones_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM live_requests_signal(array(SELECT "companyId" FROM live_new));
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM live_requests_signal(array(SELECT "companyId" FROM live_old));
    ELSE
        PERFORM live_requests_signal(array(
            SELECT n."companyId" FROM live_new n JOIN live_old o ON o.id = n.id
            WHERE n.status IS DISTINCT FROM o.status
        ));
    END IF;
    RETURN NULL;
END
$$;

-- Three triggers to a table, one for each event, as part 1's: a trigger with
-- transition tables handles one event, and none may name its columns.
DO $$
DECLARE
    t record;
BEGIN
    FOR t IN SELECT * FROM (VALUES
        ('Request', 'live_requests_changed'),
        ('PermissionRequest', 'live_requests_changed'),
        ('MissingPunchRequest', 'live_requests_changed'),
        ('OvertimeApproval', 'live_requests_changed'),
        ('RoleRequest', 'live_requests_changed'),
        ('DayOffRequest', 'live_person_requests_changed'),
        ('ProfileUpdateRequest', 'live_person_requests_changed'),
        ('AttendanceDay', 'live_overtime_days_changed'),
        ('AttendancePunch', 'live_flagged_punches_changed'),
        ('CheckInPhone', 'live_phones_changed')
    ) AS v(tbl, fn) LOOP
        EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION %I()',
            'live_requests_inserted', t.tbl, t.fn);
        EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING OLD TABLE AS live_old NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION %I()',
            'live_requests_updated', t.tbl, t.fn);
        EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS live_old FOR EACH STATEMENT EXECUTE FUNCTION %I()',
            'live_requests_deleted', t.tbl, t.fn);
    END LOOP;
END
$$;
