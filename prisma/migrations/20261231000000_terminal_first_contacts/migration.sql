-- A terminal's first contacts, kept for the Super Admin to read
-- (ATTENDANCE_PLAN.md §17.8, Phase 4 part 5, PR 294): what a terminal
-- straight to Nizmo sent in its first requests, to compare with what Nizmo
-- expects. Only adds: a table, and a column empty for every terminal.

-- One request Nizmo took from a terminal: when, how, its headers and its
-- body with names, card numbers and pictures taken out, what kind of
-- request it was, and what Nizmo made of it. Never the secret: the path is
-- the route's pattern. The first 50 for each terminal, 5 of a kind, each
-- deleted after 7 days by the nightly job.
CREATE TABLE "TerminalFirstContact" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "otherHeaders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "TerminalFirstContact_pkey" PRIMARY KEY ("id")
);

-- Read a terminal at a time, in the order they came; pruned by age.
CREATE INDEX "TerminalFirstContact_deviceId_receivedAt_idx" ON "TerminalFirstContact"("deviceId", "receivedAt");
CREATE INDEX "TerminalFirstContact_receivedAt_idx" ON "TerminalFirstContact"("receivedAt");

-- They go with their terminal.
ALTER TABLE "TerminalFirstContact" ADD CONSTRAINT "TerminalFirstContact_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AttendanceDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- When the first request was taken from a terminal straight to Nizmo: its
-- contacts are kept for 7 days from then. Empty until it sends one.
ALTER TABLE "AttendanceDevice" ADD COLUMN "firstContactAt" TIMESTAMP(3);

-- Every table has Row Level Security on (DATABASE_SETUP.md).
ALTER TABLE "TerminalFirstContact" ENABLE ROW LEVEL SECURITY;
