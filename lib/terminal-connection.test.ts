import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"

/**
 * One terminal whichever way it connects (ATTENDANCE_PLAN.md §17.6, Phase 4
 * part 4, PR 290): what the migration adds, what the schema says of it, and
 * that both ways in go through the same steps. What it does in a database is
 * in `terminal-connection.db.test.ts`.
 */

const read = (path: string) => readFileSync(path, "utf8")

describe("the migration and the schema", () => {
    const name = readdirSync("prisma/migrations").find(m => m.endsWith("_terminal_connection"))
    const migration = name ? read(`prisma/migrations/${name}/migration.sql`).split("\n").filter(line => !line.startsWith("--")).join("\n") : ""
    const schema = read("prisma/schema.prisma")
    const model = (model: string) => schema.slice(schema.indexOf(`model ${model} {`), schema.indexOf("\n}\n", schema.indexOf(`model ${model} {`)))

    it("only adds: previews migrate the live database, and the code live meanwhile knows none of it", () => {
        expect(name).toBeDefined()
        expect(migration).not.toMatch(/\b(DROP|TRUNCATE)\b|DELETE FROM|UPDATE\s+"/)
        expect(migration).not.toMatch(/ALTER TABLE[^;]*\b(ALTER|DROP) COLUMN/)
        // Every column either has a default or may be empty, so an insert that doesn't name it still works.
        const columns = migration.match(/ADD COLUMN[^,;]+/g) ?? []
        expect(columns.length).toBe(10)
        for (const c of columns) expect(/NOT NULL/.test(c) ? /DEFAULT/.test(c) : true, c).toBe(true)
    })

    it("puts the connection on the terminal, through the agent for every terminal there is", () => {
        expect(migration).toContain(`CREATE TYPE "TerminalConnection" AS ENUM ('AGENT', 'DIRECT')`)
        expect(migration).toContain(`ADD COLUMN "connection" "TerminalConnection" NOT NULL DEFAULT 'AGENT'`)
        expect(schema).toMatch(/enum TerminalConnection \{\s+AGENT\s+DIRECT\s+\}/)
        expect(model("AttendanceDevice")).toMatch(/connection\s+TerminalConnection\s+@default\(AGENT\)/)
    })

    it("adds what a terminal straight to Nizmo needs, each empty to start", () => {
        const device = model("AttendanceDevice")
        expect(migration).toContain(`ADD COLUMN "pushSecretHash" TEXT`)
        expect(migration).toContain(`CREATE UNIQUE INDEX "AttendanceDevice_pushSecretHash_key" ON "AttendanceDevice"("pushSecretHash")`)
        expect(device).toMatch(/pushSecretHash\s+String\?\s+@unique/)
        expect(migration).toContain(`ADD COLUMN "allowedAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[]`)
        expect(device).toMatch(/allowedAddresses\s+String\[\]\s+@default\(\[\]\)/)
        for (const column of ["pushCursor", "lastAddress", "lastRefusal", "addedById"]) {
            expect(migration).toContain(`ADD COLUMN "${column}" TEXT`)
            expect(device).toMatch(new RegExp(`${column}\\s+String\\?`))
        }
        expect(migration).toContain(`ADD COLUMN "refusedCount" INTEGER NOT NULL DEFAULT 0`)
        expect(device).toMatch(/refusedCount\s+Int\s+@default\(0\)/)
        expect(migration).toContain(`ADD COLUMN "lastRefusedAt" TIMESTAMP(3)`)
        expect(device).toMatch(/lastRefusedAt\s+DateTime\?/)
    })

    it("adds the Super Admin's switch to the company, off", () => {
        expect(migration).toMatch(/ALTER TABLE "Company"\s+ADD COLUMN "terminalsDirectAllowed" BOOLEAN NOT NULL DEFAULT false/)
        expect(model("Company")).toMatch(/terminalsDirectAllowed\s+Boolean\s+@default\(false\)/)
    })

    it("stores a scan once across both ways, by an index over the two sources only", () => {
        expect(migration).toMatch(/CREATE UNIQUE INDEX "AttendancePunch_terminal_scan_once"\s+ON "AttendancePunch"\("companyId", "sourceKey"\)\s+WHERE "?source"? IN \('AGENT', 'DEVICE_PUSH'\)/)
        // Prisma can't say a partial index: the schema names it where the punch's key is described.
        expect(model("AttendancePunch")).toContain("AttendancePunch_terminal_scan_once")
    })
})

describe("one way in for both", () => {
    const ingest = read("lib/services/attendance-ingest.service.ts")
    const devices = read("lib/services/attendance-device.service.ts")

    it("looks for a punch already there under either source, in one place", () => {
        expect(ingest.match(/source: \{ in: \[\.\.\.TERMINAL_SOURCES\] \}/g)).toHaveLength(1)
        expect(ingest).toMatch(/TERMINAL_SOURCES = \["AGENT", "DEVICE_PUSH"\] as const/)
        expect(ingest).not.toMatch(/where: \{ companyId, source: "AGENT"/)
    })

    it("takes the agent's punches and a terminal's own through the same steps", () => {
        const shared = ingest.slice(ingest.indexOf("async function store("), ingest.indexOf("export class AttendanceIngestService"))
        // The employee numbers, the months' lock, what's already there, the direction, the terminal's last scan.
        for (const step of ["attendance-codes:", "punchMonthsOf(", "lockMonths(", "lockedMonths(", "createMany(", "direction:", "lastPunchAt"]) expect(shared, step).toContain(step)
        const service = ingest.slice(ingest.indexOf("export class AttendanceIngestService"))
        expect(service.match(/await store\(tx, /g)).toHaveLength(2)
        expect(service).toMatch(/"AGENT"/)
        expect(service).toMatch(/"DEVICE_PUSH"/)
        // Neither writes a punch on its own.
        expect(service).not.toContain("attendancePunch.create")
        expect(service.match(/recomputeAfter\(/g)).toHaveLength(2)
    })

    it("answers DIRECT in the heartbeat without taking what the agent says of the terminal", () => {
        expect(devices).toMatch(/export type DeviceState = "ACTIVE" \| "RETIRED" \| "CLAIMED_ELSEWHERE" \| "DIRECT"/)
        const report = devices.slice(devices.indexOf("private static async report("))
        const direct = report.indexOf(`state: "DIRECT" as const`)
        expect(direct).toBeGreaterThan(-1)
        // Before the terminal's health is written, and after a retired one is turned away.
        expect(direct).toBeLessThan(report.indexOf("data: health"))
        expect(direct).toBeGreaterThan(report.indexOf(`state: "RETIRED" as const`))
    })
})

describe("the Punches list", () => {
    it("names the terminal a scan came from, whichever way it came", () => {
        const page = read("app/(dashboard)/dashboard/attendance/page.tsx")
        expect(page).toMatch(/x\.source === 'AGENT' \|\| x\.source === 'DEVICE_PUSH' \? t\('punch_source_terminal'\)/)
        // Not as imported, which is what anything else that isn't the app's or typed in reads as.
        expect(page).not.toMatch(/x\.source === 'AGENT' \? t\('punch_source_terminal'\)/)
    })
})

describe("the agent", () => {
    it("is a new version, the same everywhere it is written", () => {
        const version = /AGENT_VERSION = "([\d.]+)"/.exec(read("agent/src/version.ts"))![1]
        // 0.2.0 knew a terminal straight to Nizmo (PR 290); 0.3.0 reads Hikvision (PR 302); 0.4.0 listens for terminals that push (PR 305).
        expect(version).toBe("0.4.0")
        expect(JSON.parse(read("agent/package.json")).version).toBe(version)
        const lock = JSON.parse(read("agent/package-lock.json"))
        expect(lock.version).toBe(version)
        expect(lock.packages[""].version).toBe(version)
    })

    it("knows the state the heartbeat answers for a terminal straight to Nizmo", () => {
        expect(read("agent/src/api.ts")).toMatch(/state: "ACTIVE" \| "RETIRED" \| "CLAIMED_ELSEWHERE" \| "DIRECT"/)
        expect(read("agent/src/state.ts")).toMatch(/direct\?: boolean/)
        expect(read("agent/README.md")).toMatch(/straight to Nizmo/)
    })
})
