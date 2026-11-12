-- Live updates, part 6b (REALTIME_PLAN.md): the database says when someone
-- in a company comes or goes, so the Online badge on the Employees list and
-- All users changes as it happens, rather than as the list is loaded again.
--
-- Only adds things: one function, the two triggers that call it, and one
-- rule on Supabase's realtime.messages. No row is read or changed by it, and
-- nothing anyone does today works differently.
--
-- As the other parts' signals, it says only that something changed, never
-- what: its event is 'changed' and its payload empty. Not who came or went.
-- It goes on a channel of its own for each company, online:<company id>,
-- which a tab joins only while a screen showing the badge is open: a coming
-- or going is heard by the few people looking, not by every tab, as the
-- company's other channels are. There's no channel for every company:
-- Supabase counts a signal once as it's sent, listened to or not, and the
-- Super Admin's lists of everyone join the channel of each company they show.
--
-- From each tab's row (part 6a, "OpenTab"), once per statement for each
-- company it touched:
--   - a tab here for the first time, or here again after it went;
--   - a tab gone: closed, out of sight for 2 minutes, or signed out;
--   - a tab here again after its row had run out, as a phone that paused the
--     app for longer wakes it: the row said here throughout, but the person
--     showed as offline. 32 minutes is lib/presence.ts's ONLINE_WINDOW_MS,
--     two heartbeats and the 2 minutes a tab may be out of sight
--     (lib/presence.test.ts reads it here).
-- Not the heartbeat's beat, which keeps a tab here as it was, and not the
-- daily sweep, which deletes only rows that had run out already.

CREATE OR REPLACE FUNCTION live_online_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    people text[];
    company text;
BEGIN
    -- As the other parts' triggers, each branch reads only the transition
    -- table its event has. An upsert's new rows are in the insert's table,
    -- and the rows it changed in the update's; a report the order kept out
    -- is in neither.
    IF TG_OP = 'INSERT' THEN
        people := array(SELECT DISTINCT "userId" FROM live_new WHERE here);
    ELSE
        people := array(
            SELECT DISTINCT n."userId"
            FROM live_new n JOIN live_old o ON o."userId" = n."userId" AND o."tabId" = n."tabId"
            WHERE n.here IS DISTINCT FROM o.here
               OR (n.here AND n."seenAt" - o."seenAt" > interval '32 minutes')
        );
    END IF;
    FOR company IN
        SELECT DISTINCT "companyId" FROM "User"
        WHERE id = ANY (people) AND "companyId" IS NOT NULL ORDER BY 1
    LOOP
        PERFORM live_signal('online:' || company);
    END LOOP;
    RETURN NULL;
END
$$;

-- Two triggers, one for each event, as the other parts': a trigger with
-- transition tables handles one event, and none may name its columns.
CREATE TRIGGER live_online_inserted AFTER INSERT ON "OpenTab"
    REFERENCING NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_online_changed();
CREATE TRIGGER live_online_updated AFTER UPDATE ON "OpenTab"
    REFERENCING OLD TABLE AS live_old NEW TABLE AS live_new FOR EACH STATEMENT EXECUTE FUNCTION live_online_changed();

-- Who may listen: a company's people who may see the Employees list, their
-- own company's channel only; and the Super Admin, any company's. The rule
-- can't read the app's permissions, so the app's token says whether its
-- person may see the list (sees_online, app/api/realtime/token/route.ts).
-- Broadcasts only, and only to read, as part 1's rule.
DO $$
BEGIN
    IF to_regclass('realtime.messages') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE $policy$
            CREATE POLICY "Live updates: who's online, to those who may see the list"
            ON realtime.messages FOR SELECT TO authenticated
            USING (
                realtime.messages.extension = 'broadcast'
                AND (
                    (
                        ((SELECT auth.jwt()) ->> 'sees_online') = 'true'
                        AND (SELECT realtime.topic()) = 'online:' || ((SELECT auth.jwt()) ->> 'company_id')
                    )
                    OR (
                        ((SELECT auth.jwt()) ->> 'super_admin') = 'true'
                        AND (SELECT realtime.topic()) ~ '^online:[^:]+$'
                    )
                )
            )
        $policy$;
    END IF;
END
$$;
