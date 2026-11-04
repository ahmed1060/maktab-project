-- Signing in's limit (lib/sign-in-lock.ts, PR 183): each run of wrong tries
-- on an account has its own id, so a try waiting on the step that asks for
-- the code is given back only to the run it was counted in, not to one
-- started after the account was unlocked or signed in (Codex on PR 183).
--
-- Only added, and empty for every other count: the release before names no
-- such column, and a run it started has none, which is a run like any other.
ALTER TABLE "RateLimit" ADD COLUMN "run" TEXT;
