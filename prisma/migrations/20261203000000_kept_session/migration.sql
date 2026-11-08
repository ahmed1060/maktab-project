-- A new password ends the account's other sessions (lib/session-kept.ts,
-- PR 228): its sessionVersion moves on. The session a person sets their own
-- from is kept, and the account remembers it here, as the version that
-- ended the others and the session's id.
--
-- Only added, and empty: the release before names no such column, and an
-- account without one keeps no session, as before.
ALTER TABLE "User" ADD COLUMN "keptSession" TEXT;
ALTER TABLE "SuperAdmin" ADD COLUMN "keptSession" TEXT;
