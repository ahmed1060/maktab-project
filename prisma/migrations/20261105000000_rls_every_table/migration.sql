-- Row Level Security, default-deny, on every table again.
--
-- 0_init turned it on for every table there was then, by looping over the
-- schema rather than naming tables, so the list couldn't drift. But a loop
-- runs once: the 44 tables created by later migrations (roles, attendance,
-- the face check, check-in phones, records' removed files, and more) never
-- had it. They're unreachable today only because Supabase's Data API roles
-- (anon, authenticated, service_role) hold no grants on them. One grant,
-- such as the ones Supabase's October 2026 email suggests, would have opened
-- them to the public key the browser carries.
--
-- Nothing changes for the app: it reaches Postgres only through Prisma, as
-- the tables' owner, which RLS doesn't restrict. No policies are added, so
-- RLS is default-deny for everyone else.
--
-- A table a later migration creates enables it in that same migration:
-- lib/rls-migrations.test.ts fails otherwise (DATABASE_SETUP.md).

DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
END
$$;
