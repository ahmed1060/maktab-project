-- The session one of a client's people changes their password from
-- (CLIENT_PORTAL_PLAN.md §5.3, §12 step 7d-2, PR 335), kept while the new
-- password ends the account's other sessions, as a person's is kept
-- (lib/session-kept.ts, PR 228): the version that ended the others, and the
-- session's id. None until a password is changed from the client's area.
-- A column of its own with nothing in it: the code running meanwhile
-- neither reads nor writes it.
ALTER TABLE "ClientAccount" ADD COLUMN "keptSession" TEXT;
