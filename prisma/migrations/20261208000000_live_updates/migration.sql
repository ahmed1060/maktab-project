-- Live updates, part 1 (REALTIME_PLAN.md): the database says when a
-- company's tasks change, or a person's notifications do, and only the
-- right people may listen.
--
-- Only adds things: four functions, the triggers that call them, and one
-- rule on Supabase's realtime.messages. No row is read or changed by it,
-- and nothing anyone does today works differently.
--
-- A signal says only that something changed, never what: its payload is
-- empty. Each open screen that hears one draws itself again, through the
-- app's own routes and checks.
--
-- It's sent with realtime.send(), which writes it in the same transaction as
-- the change: it goes out only if the change is saved. One per statement for
-- each company or person it touched, not one per row, so a bulk upload of
-- fifty tasks is one signal for its company.
--
-- On a database without Supabase's realtime schema, as in the tests' own
-- Postgres, live_signal() finds no realtime.send() and does nothing, and the
-- rule isn't added. A signal that can't be sent only warns: the change it was
-- for is saved all the same.

CREATE OR REPLACE FUNCTION live_signal(topic text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF topic IS NULL OR to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
        RETURN;
    END IF;
    BEGIN
        PERFORM realtime.send('{}'::jsonb, 'changed', topic, true);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Live update not sent on %: %', topic, SQLERRM;
    END;
END
$$;

-- A trigger that reads a statement's rows reads them from transition tables,
-- and one handles a single kind of event: inserted rows are only new, deleted
-- ones only old. Each function below reads only the table its event has; a
-- branch not taken is never planned, so the other is never looked for.

-- A company's tasks: every company a statement's tasks were in, before or after.
CREATE OR REPLACE FUNCTION live_tasks_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    company text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        FOR company IN SELECT DISTINCT "companyId" FROM live_new WHERE "companyId" IS NOT NULL ORDER BY 1 LOOP
            PERFORM live_signal('tasks:' || company);
        END LOOP;
    ELSIF TG_OP = 'DELETE' THEN
        FOR company IN SELECT DISTINCT "companyId" FROM live_old WHERE "companyId" IS NOT NULL ORDER BY 1 LOOP
            PERFORM live_signal('tasks:' || company);
        END LOOP;
    ELSE
        FOR company IN
            SELECT c FROM (SELECT "companyId" AS c FROM live_new UNION SELECT "companyId" FROM live_old) rows
            WHERE c IS NOT NULL ORDER BY 1
        LOOP
            PERFORM live_signal('tasks:' || company);
        END LOOP;
    END IF;
    RETURN NULL;
END
$$;

-- Who's on a task: the companies of the tasks a statement put people on, or took them off.
CREATE OR REPLACE FUNCTION live_assignees_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    company text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        FOR company IN
            SELECT DISTINCT t."companyId" FROM live_new a JOIN "Task" t ON t.id = a."A"
            WHERE t."companyId" IS NOT NULL ORDER BY 1
        LOOP
            PERFORM live_signal('tasks:' || company);
        END LOOP;
    ELSE
        FOR company IN
            SELECT DISTINCT t."companyId" FROM live_old a JOIN "Task" t ON t.id = a."A"
            WHERE t."companyId" IS NOT NULL ORDER BY 1
        LOOP
            PERFORM live_signal('tasks:' || company);
        END LOOP;
    END IF;
    RETURN NULL;
END
$$;

-- A person's notifications: everyone, or every Super Admin, a statement's
-- notifications were for, added or read.
CREATE OR REPLACE FUNCTION live_notices_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    principal text;
BEGIN
    FOR principal IN
        SELECT DISTINCT coalesce("userId", "superAdminId") FROM live_new
        WHERE coalesce("userId", "superAdminId") IS NOT NULL ORDER BY 1
    LOOP
        PERFORM live_signal('notices:' || principal);
    END LOOP;
    RETURN NULL;
END
$$;

CREATE TRIGGER live_tasks_inserted AFTER INSERT ON "Task"
    REFERENCING NEW TABLE AS live_new
    FOR EACH STATEMENT EXECUTE FUNCTION live_tasks_changed();
CREATE TRIGGER live_tasks_updated AFTER UPDATE ON "Task"
    REFERENCING OLD TABLE AS live_old NEW TABLE AS live_new
    FOR EACH STATEMENT EXECUTE FUNCTION live_tasks_changed();
CREATE TRIGGER live_tasks_deleted AFTER DELETE ON "Task"
    REFERENCING OLD TABLE AS live_old
    FOR EACH STATEMENT EXECUTE FUNCTION live_tasks_changed();

CREATE TRIGGER live_assignees_inserted AFTER INSERT ON "_MultipleAssignees"
    REFERENCING NEW TABLE AS live_new
    FOR EACH STATEMENT EXECUTE FUNCTION live_assignees_changed();
CREATE TRIGGER live_assignees_deleted AFTER DELETE ON "_MultipleAssignees"
    REFERENCING OLD TABLE AS live_old
    FOR EACH STATEMENT EXECUTE FUNCTION live_assignees_changed();

CREATE TRIGGER live_notices_inserted AFTER INSERT ON "Notification"
    REFERENCING NEW TABLE AS live_new
    FOR EACH STATEMENT EXECUTE FUNCTION live_notices_changed();
CREATE TRIGGER live_notices_updated AFTER UPDATE ON "Notification"
    REFERENCING NEW TABLE AS live_new
    FOR EACH STATEMENT EXECUTE FUNCTION live_notices_changed();

-- Who may listen. Supabase lets a browser join a private channel only if a
-- rule on realtime.messages lets its token read that channel's messages.
-- The token is the app's own (app/api/realtime/token/route.ts), naming the
-- person (sub), their company (company_id) and whether they're the Super
-- Admin (super_admin):
--   - tasks:<company id>: that company's people, and the Super Admin;
--   - notices:<person id>: that person, or Super Admin, alone.
-- Broadcasts only, and only to read: with no rule to write, no browser can
-- send anything on them.
DO $$
BEGIN
    IF to_regclass('realtime.messages') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE $policy$
            CREATE POLICY "Live updates: a company's tasks, and a person's own notices"
            ON realtime.messages FOR SELECT TO authenticated
            USING (
                realtime.messages.extension = 'broadcast'
                AND (
                    (SELECT realtime.topic()) = 'notices:' || ((SELECT auth.jwt()) ->> 'sub')
                    OR (SELECT realtime.topic()) = 'tasks:' || ((SELECT auth.jwt()) ->> 'company_id')
                    OR (
                        ((SELECT auth.jwt()) ->> 'super_admin') = 'true'
                        AND (SELECT realtime.topic()) ~ '^tasks:[^:]+$'
                    )
                )
            )
        $policy$;
    END IF;
END
$$;
