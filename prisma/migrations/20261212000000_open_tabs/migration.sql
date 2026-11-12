-- Who's online, part 6a (REALTIME_PLAN.md §3): each open tab has a row of its
-- own, added as it's shown and taken away as it closes or has been out of
-- sight for 2 minutes. A person signed in is online while any tab of theirs
-- has a fresh row (lib/presence.ts).
--
-- Only adds a table. No row anywhere is read or changed by it. Until a tab
-- loads the new script, the Employees list reads no row for anyone and shows
-- them offline: the first beat of a tab still on the old script adds one, as
-- the person's one tab.

CREATE TABLE "OpenTab" (
    "userId" TEXT NOT NULL,
    -- Made by the tab for itself as its page loads (lib/tab-presence.ts).
    "tabId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenTab_pkey" PRIMARY KEY ("userId", "tabId")
);

-- A person's newest tab, which the Employees list reads for each person.
CREATE INDEX "OpenTab_userId_seenAt_idx" ON "OpenTab"("userId", "seenAt");
-- The daily sweep of rows past the window (/api/cron/prune).
CREATE INDEX "OpenTab_seenAt_idx" ON "OpenTab"("seenAt");

ALTER TABLE "OpenTab" ADD CONSTRAINT "OpenTab_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every table has Row Level Security on (DATABASE_SETUP.md).
ALTER TABLE "OpenTab" ENABLE ROW LEVEL SECURITY;
