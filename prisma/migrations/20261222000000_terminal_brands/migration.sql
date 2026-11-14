-- Terminal brands (ATTENDANCE_PLAN.md §17.9, Phase 4 part 3, PR 279): what
-- is printed on a terminal, kept by the Super Admin, apart from the protocol
-- Nizmo and the agent speak to it. Protocols are code, two of them; brands
-- are rows, starting with ZKTeco, Hikvision and Convoy, which speaks
-- ZKTeco's protocol (from its screens, 14 November 2026).
CREATE TYPE "TerminalProtocol" AS ENUM ('ZKTECO', 'HIKVISION');

CREATE TABLE "TerminalBrand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" "TerminalProtocol" NOT NULL,
    "notesEn" TEXT,
    "notesAr" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "TerminalBrand_pkey" PRIMARY KEY ("id")
);

-- One brand to a name, capitals aside: "zkteco" can't sit beside "ZKTeco".
CREATE UNIQUE INDEX "TerminalBrand_name_lower_key" ON "TerminalBrand" (lower("name"));

INSERT INTO "TerminalBrand" ("id", "name", "protocol", "updatedAt")
SELECT gen_random_uuid()::text, b."name", b."protocol"::"TerminalProtocol", now()
FROM (VALUES
    ('ZKTeco', 'ZKTECO'),
    ('Hikvision', 'HIKVISION'),
    ('Convoy', 'ZKTECO')
) AS b("name", "protocol");

-- A terminal speaks a protocol and may have a brand printed on it. Those
-- already there speak ZKTeco's, the only one the agent reads, and have no
-- brand until an Admin picks one (part 3's second PR). A brand a terminal
-- has can't be deleted, only retired.
ALTER TABLE "AttendanceDevice" ADD COLUMN "protocol" "TerminalProtocol" NOT NULL DEFAULT 'ZKTECO';
ALTER TABLE "AttendanceDevice" ADD COLUMN "brandId" TEXT;
ALTER TABLE "AttendanceDevice" ADD CONSTRAINT "AttendanceDevice_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "TerminalBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AttendanceDevice_brandId_idx" ON "AttendanceDevice"("brandId");

-- Every table has Row Level Security on (DATABASE_SETUP.md).
ALTER TABLE "TerminalBrand" ENABLE ROW LEVEL SECURITY;
