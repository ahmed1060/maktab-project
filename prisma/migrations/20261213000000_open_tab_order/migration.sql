-- Who's online, part 6a (REALTIME_PLAN.md §3), after Codex's review of #262.
--
-- A tab's reports can reach the server either way round, as a closing tab's
-- beacon overtaking the beat it sent just before. Each now carries its place
-- in the tab's order ("seq"), and a row keeps a report only if none after it
-- has arrived. A tab that goes is marked gone ("here" false) rather than
-- deleted, so a report sent before that, arriving after, can't bring it back.
--
-- And each row says which browser's session it came from ("sid", the id the
-- session's token is given at sign-in), so signing out closes every tab of
-- that browser, whose own reports the server refuses once the session ends,
-- and none of the person's other devices.
--
-- Only adds columns, with defaults. Rows already there (none in production,
-- where nothing writes the table yet) are tabs that are here, first in their
-- order, from no named session.

ALTER TABLE "OpenTab" ADD COLUMN "seq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OpenTab" ADD COLUMN "here" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "OpenTab" ADD COLUMN "sid" TEXT;
