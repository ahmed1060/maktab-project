-- One terminal whichever way it connects (ATTENDANCE_PLAN.md §17.6, §8.6,
-- Phase 4 part 4). Only adds: previews migrate the live database, and the
-- code live meanwhile knows none of this.

-- How a terminal's scans reach Nizmo: through the office agent, as every
-- terminal there is does, or straight from the terminal itself (§17.1).
CREATE TYPE "TerminalConnection" AS ENUM ('AGENT', 'DIRECT');

-- What a terminal straight to Nizmo needs: its secret's hash (§17.2), the
-- addresses it may call from (§17.3), where it had got to in its log, where
-- its last request came from, what was refused (§17.5), and who added it.
ALTER TABLE "AttendanceDevice"
    ADD COLUMN "connection" "TerminalConnection" NOT NULL DEFAULT 'AGENT',
    ADD COLUMN "pushSecretHash" TEXT,
    ADD COLUMN "allowedAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "pushCursor" TEXT,
    ADD COLUMN "lastAddress" TEXT,
    ADD COLUMN "refusedCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastRefusedAt" TIMESTAMP(3),
    ADD COLUMN "lastRefusal" TEXT,
    ADD COLUMN "addedById" TEXT;

CREATE UNIQUE INDEX "AttendanceDevice_pushSecretHash_key" ON "AttendanceDevice"("pushSecretHash");

-- The Super Admin's switch for terminals straight to Nizmo, off (§17.8).
ALTER TABLE "Company"
    ADD COLUMN "terminalsDirectAllowed" BOOLEAN NOT NULL DEFAULT false;

-- A scan is stored once whichever way it came (§17.6): the agent's punches
-- and a terminal's own have different sources and the same key, the
-- terminal's own record of the scan. No terminal punch is there twice when
-- this runs: until now only the agent stored them, once each by
-- (companyId, source, sourceKey).
CREATE UNIQUE INDEX "AttendancePunch_terminal_scan_once"
    ON "AttendancePunch"("companyId", "sourceKey")
    WHERE source IN ('AGENT', 'DEVICE_PUSH');
