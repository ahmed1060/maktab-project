-- Live updates, part 3 (REALTIME_PLAN.md): someone who can't go on, as when
-- they're suspended, closed or deleted, or their company is banned, is told
-- so at once, and their screen signs itself out, rather than at their
-- heartbeat's next beat, up to 90 seconds on.
--
-- Only adds things: two functions, a second form of live_signal() that names
-- its event, and the two triggers that call them. No row is read or changed
-- by it, and nothing anyone does today works differently.
--
-- As part 1's signals, it says only that something changed, never what: its
-- event is 'account' and its payload empty, on the channels part 1 already
-- lets the right people hear, the person's own (notices:<id>) and their
-- company's (tasks:<id>). The screen that hears it asks the heartbeat
-- (POST /api/user/activity), which reads the account as it is and signs the
-- page out, saving the work open on it, as it does at its beat.
--
-- Each trigger runs for a row only when its column changed to what ends
-- access: the heartbeat writes "User" every 90 seconds for every open tab
-- (lastActivity), and signing in and out write its status, so a trigger on
-- any update would signal with each of them.

CREATE OR REPLACE FUNCTION live_signal(topic text, event text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF topic IS NULL OR to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
        RETURN;
    END IF;
    BEGIN
        PERFORM realtime.send('{}'::jsonb, event, topic, true);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Live update not sent on %: %', topic, SQLERRM;
    END;
END
$$;

-- A person suspended, closed or deleted: to them, on every tab of theirs.
CREATE OR REPLACE FUNCTION live_account_ended() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM live_signal('notices:' || NEW.id, 'account');
    RETURN NULL;
END
$$;

-- A company banned: to everyone of it, on their company's channel.
CREATE OR REPLACE FUNCTION live_company_banned() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM live_signal('tasks:' || NEW.id, 'account');
    RETURN NULL;
END
$$;

CREATE TRIGGER live_account_ended AFTER UPDATE OF status ON "User"
    FOR EACH ROW
    WHEN (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('SUSPENDED', 'ARCHIVED', 'DELETED'))
    EXECUTE FUNCTION live_account_ended();

CREATE TRIGGER live_company_banned AFTER UPDATE OF "isBanned" ON "Company"
    FOR EACH ROW
    WHEN (NEW."isBanned" AND NOT OLD."isBanned")
    EXECUTE FUNCTION live_company_banned();
