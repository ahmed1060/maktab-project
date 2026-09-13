-- A tally of how often each company reaches for a module its package does not
-- include. Because a locked module stays visible, every attempt already arrives
-- at the server as a request, so this is counted from traffic that exists
-- rather than from any new client-side event.
--
-- Per company per module per month, never per person: the count answers the
-- commercial question, while storing which employee clicked what is behavioural
-- data about a customer's staff with real privacy weight and no extra value.

CREATE TABLE "LockedModuleAttempt" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "module"    TEXT NOT NULL,
    -- First day of the month, UTC. Bucketed rather than one row per click: the
    -- question is a trend, and an unbounded event log for something this
    -- repetitive is a table nobody ever prunes.
    "month"     TIMESTAMP(3) NOT NULL,
    "count"     INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LockedModuleAttempt_pkey" PRIMARY KEY ("id")
);

-- The unique key is what makes the upsert-and-increment safe under concurrency:
-- two simultaneous attempts race to insert, one wins, the other updates.
CREATE UNIQUE INDEX "LockedModuleAttempt_companyId_module_month_key"
    ON "LockedModuleAttempt"("companyId", "module", "month");
CREATE INDEX "LockedModuleAttempt_companyId_idx" ON "LockedModuleAttempt"("companyId");
CREATE INDEX "LockedModuleAttempt_month_idx" ON "LockedModuleAttempt"("month");

ALTER TABLE "LockedModuleAttempt"
    ADD CONSTRAINT "LockedModuleAttempt_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

-- Matches every other table in this schema (enable_rls_default_deny): the app
-- connects as the table owner and bypasses it, while anything arriving through
-- PostgREST is denied by default.
ALTER TABLE "LockedModuleAttempt" ENABLE ROW LEVEL SECURITY;
