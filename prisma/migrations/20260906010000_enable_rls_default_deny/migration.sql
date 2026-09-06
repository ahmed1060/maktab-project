-- Row Level Security, default-deny, no permissive policies, on every
-- table Supabase's advisor flagged as fully exposed to the anon/
-- authenticated Postgres roles (i.e. reachable via Supabase's PostgREST
-- API and the JS client with a public key) if that key were ever used
-- against them. Confirmed safe before applying: the app talks to Postgres
-- exclusively through Prisma's direct connection, which uses a role that
-- bypasses RLS entirely and is completely unaffected by this — and the
-- one place a Supabase client exists at all (lib/storage.ts) uses the
-- service_role key (also RLS-exempt) and only touches Storage, never
-- calls .from()/.rpc() against a Postgres table. So this changes nothing
-- about how the app works today; it only closes off the public REST API
-- for anyone who ever obtains a client-side Supabase key in the future
-- (e.g. for Realtime), which today would otherwise read/write every row
-- of every table with zero restriction.
--
-- No policies are added — RLS enabled with none means default-deny for
-- anon/authenticated. Only service_role (and Prisma's own connection)
-- can still read/write, exactly as before.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SuperAdmin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Obligation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientSection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProfileUpdateRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DayOffRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryAdjustment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DayOffCreditSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_MultipleAssignees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_ObligationAssignees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RateLimit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VerificationCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrustedDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SystemSettings" ENABLE ROW LEVEL SECURITY;
