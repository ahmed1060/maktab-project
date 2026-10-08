-- Tokens a rotation hands an agent, kept until used or a day old (review on
-- #17). There was one slot, "nextTokenHash": two rotations that overlapped (a
-- retry while the first was still being written) each replaced the other's
-- token, and the agent could keep the one replaced, the old token gone once
-- the other was used. Now every token a rotation hands out works until it
-- runs out, the first use of any of them making it the agent's token.
CREATE TABLE "AttendanceAgentPendingToken" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceAgentPendingToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AttendanceAgentPendingToken_tokenHash_key" ON "AttendanceAgentPendingToken"("tokenHash");
CREATE INDEX "AttendanceAgentPendingToken_agentId_idx" ON "AttendanceAgentPendingToken"("agentId");
ALTER TABLE "AttendanceAgentPendingToken" ADD CONSTRAINT "AttendanceAgentPendingToken_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "AttendanceAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A rotation in flight carries over, its day starting now.
INSERT INTO "AttendanceAgentPendingToken"("id", "agentId", "tokenHash")
SELECT gen_random_uuid()::text, "id", "nextTokenHash" FROM "AttendanceAgent"
WHERE "nextTokenHash" IS NOT NULL AND "status" = 'ACTIVE';

ALTER TABLE "AttendanceAgent" DROP CONSTRAINT "AttendanceAgent_revoked";
ALTER TABLE "AttendanceAgent" DROP COLUMN "nextTokenHash";
ALTER TABLE "AttendanceAgent" ADD CONSTRAINT "AttendanceAgent_revoked" CHECK (("status" = 'REVOKED') = ("revokedAt" IS NOT NULL)
    AND ("status" <> 'REVOKED' OR ("codeHash" IS NULL AND "tokenHash" IS NULL)));

-- A revoked agent still holds nothing that works, at the database: a token is
-- handed out only to an agent in use (its row locked, so a revocation in
-- flight is waited for and seen), and revoking drops any not yet used.
CREATE FUNCTION attendance_agent_pending_token_for_active() RETURNS trigger AS $$
BEGIN
    PERFORM 1 FROM "AttendanceAgent" WHERE "id" = NEW."agentId" AND "status" = 'ACTIVE' FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AttendanceAgentPendingToken_agent_active: agent % is not in use', NEW."agentId";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AttendanceAgentPendingToken_agent_active"
    BEFORE INSERT OR UPDATE OF "agentId" ON "AttendanceAgentPendingToken"
    FOR EACH ROW EXECUTE FUNCTION attendance_agent_pending_token_for_active();

CREATE FUNCTION attendance_agent_revoked_drops_pending() RETURNS trigger AS $$
BEGIN
    DELETE FROM "AttendanceAgentPendingToken" WHERE "agentId" = NEW."id";
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AttendanceAgent_revoked_drops_pending"
    AFTER UPDATE OF "status" ON "AttendanceAgent"
    FOR EACH ROW WHEN (NEW."status" = 'REVOKED') EXECUTE FUNCTION attendance_agent_revoked_drops_pending();
