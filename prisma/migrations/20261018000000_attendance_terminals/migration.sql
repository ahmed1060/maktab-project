-- Terminals and the Local Sync Agent (ATTENDANCE_PLAN.md §17, §20 Phase 2).
-- An agent is a program on a PC in the customer's office that reads the
-- fingerprint terminals on its network and sends their punches here. It is
-- enrolled once with a short code an admin is shown, which it exchanges for
-- a long token; both are stored only as hashes. The company is always the
-- agent's own, never anything the agent sends.

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');
CREATE TYPE "DeviceMode" AS ENUM ('ANY', 'ENTRANCE', 'EXIT');

-- CreateTable
CREATE TABLE "AttendanceAgent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'PENDING',
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "tokenHash" TEXT,
    "nextTokenHash" TEXT,
    "tokenIssuedAt" TIMESTAMP(3),
    "hostname" TEXT,
    "agentVersion" TEXT,
    "enrolledAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "queueDepth" INTEGER,
    "clockDriftSeconds" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "AttendanceAgent_pkey" PRIMARY KEY ("id"),
    -- A code is good for a limited time; a revoked agent holds nothing that works.
    CONSTRAINT "AttendanceAgent_code_expires" CHECK (("codeHash" IS NULL) = ("codeExpiresAt" IS NULL)),
    CONSTRAINT "AttendanceAgent_revoked" CHECK (("status" = 'REVOKED') = ("revokedAt" IS NOT NULL)
        AND ("status" <> 'REVOKED' OR ("codeHash" IS NULL AND "tokenHash" IS NULL AND "nextTokenHash" IS NULL)))
);

CREATE TABLE "AttendanceDevice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agentId" TEXT,
    "serialNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "firmware" TEXT,
    "mode" "DeviceMode" NOT NULL DEFAULT 'ANY',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "reachable" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "clockDriftSeconds" INTEGER,
    "userCount" INTEGER,
    "recordCount" INTEGER,
    "recordCapacity" INTEGER,
    "lastPunchAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "retiredById" TEXT,

    CONSTRAINT "AttendanceDevice_pkey" PRIMARY KEY ("id")
);

-- AlterTable: which terminal a punch came from.
ALTER TABLE "AttendancePunch" ADD COLUMN "deviceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceAgent_codeHash_key" ON "AttendanceAgent"("codeHash");
CREATE UNIQUE INDEX "AttendanceAgent_tokenHash_key" ON "AttendanceAgent"("tokenHash");
CREATE UNIQUE INDEX "AttendanceAgent_nextTokenHash_key" ON "AttendanceAgent"("nextTokenHash");
CREATE INDEX "AttendanceAgent_companyId_idx" ON "AttendanceAgent"("companyId");
CREATE UNIQUE INDEX "AttendanceDevice_companyId_serialNumber_key" ON "AttendanceDevice"("companyId", "serialNumber");
-- A terminal is in use by one company at a time: it must be retired by one
-- before another's agent can bring it in.
CREATE UNIQUE INDEX "AttendanceDevice_serialNumber_active_key" ON "AttendanceDevice"("serialNumber") WHERE "retiredAt" IS NULL;
CREATE INDEX "AttendanceDevice_agentId_idx" ON "AttendanceDevice"("agentId");
CREATE INDEX "AttendancePunch_deviceId_idx" ON "AttendancePunch"("deviceId");

-- AddForeignKey
ALTER TABLE "AttendanceAgent" ADD CONSTRAINT "AttendanceAgent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceDevice" ADD CONSTRAINT "AttendanceDevice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceDevice" ADD CONSTRAINT "AttendanceDevice_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AttendanceAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AttendanceDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
