import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { hashSecret } from "@/lib/attendance/agent-credentials"
import { isPushSecret } from "@/lib/attendance/terminal-secrets"
import { offsetMsIn } from "@/lib/time"
import { AttendanceDeviceService as Devices } from "@/lib/services/attendance-device.service"
import { AttendanceAgentService as Agents, type AuthenticatedAgent } from "@/lib/services/attendance-agent.service"

/**
 * A terminal added by hand, and its address (ATTENDANCE_PLAN.md §17.7,
 * Phase 4 part 5, PR 292), against a real Postgres built from the
 * migrations: what is added, what it waits for, what is refused, and that
 * the address issued is the one the receiving route answers (PR 291).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, timezone, "updatedAt") VALUES ('c1', 'One', 'Africa/Cairo', now()), ('c2', 'Two', 'Africa/Cairo', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('a2', 'a2@x', 'p', 'Basel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`

describe.skipIf(!ADMIN_URL)("a terminal added by hand, in Postgres", () => {
    const dbName = `terminal_add_test_${Date.now()}`
    let db: Client
    let zk = "", hik = "", convoy = ""

    beforeAll(async () => {
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`CREATE DATABASE ${dbName}`)
        await admin.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(BEFORE_ROLES)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()
        // The Super Admin has turned terminals straight to Nizmo on for the first company only (§17.8).
        await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = true WHERE id = 'c1'`)
        const { rows } = await db.query(`SELECT id, name FROM "TerminalBrand"`)
        const brand = (name: string) => rows.find(r => r.name === name).id as string
        zk = brand("ZKTeco"); hik = brand("Hikvision"); convoy = brand("Convoy")
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const row = async (id: string) => (await db.query(`SELECT * FROM "AttendanceDevice" WHERE id = $1`, [id])).rows[0]
    const count = async () => Number((await db.query(`SELECT count(*) FROM "AttendanceDevice"`)).rows[0].count)
    const audit = async (entityId: string) => (await db.query(`SELECT action, "userId", details FROM "AuditLog" WHERE "entityId" = $1 ORDER BY "createdAt"`, [entityId])).rows
    const listed = async (companyId: string, id: string) => (await Devices.list(companyId)).find(d => d.id === id)!
    const secretOf = (path: string) => path.split("/").pop()!

    /** A request as a Hikvision terminal makes it: an access event of now, by the company's wall clock. */
    let address = 0
    const call = async (path: string, body?: string) => {
        const { POST } = await import("@/app/api/terminals/hikvision/[secret]/route")
        const secret = secretOf(path)
        const now = new Date(Date.now() + offsetMsIn(new Date(), "Africa/Cairo")).toISOString().slice(0, 19)
        const event = { dateTime: `${now}+02:00`, eventType: "AccessControllerEvent", AccessControllerEvent: { majorEventType: 5, subEventType: 75, employeeNoString: "7", name: "Somebody" } }
        const from = `198.51.100.${++address}`
        const req = new Request(`https://nizmo.example${path}`, { method: "POST", body: body ?? JSON.stringify(event), headers: { "Content-Type": "application/json", "x-forwarded-for": from } })
        return { status: (await POST(req, { params: Promise.resolve({ secret }) })).status, from }
    }

    describe("through the office agent", () => {
        it("is added waiting, with what it was given, and nothing issued", async () => {
            const added = await Devices.add("c1", { name: "  Side gate ", serialNumber: " SN-100 ", brandId: convoy, mode: "ENTRANCE", connection: "AGENT" }, "a1")
            expect(added.path).toBeNull()
            expect(added.device).toMatchObject({ name: "Side gate", serialNumber: "SN-100", mode: "ENTRANCE", protocol: "ZKTECO", connection: "AGENT", brand: { id: convoy, name: "Convoy", retired: false } })
            const d = await row(added.device.id)
            expect(d).toMatchObject({ companyId: "c1", connection: "AGENT", protocol: "ZKTECO", brandId: convoy, addedById: "a1", pushSecretHash: null, agentId: null, lastSeenAt: null, retiredAt: null })
            // Waiting for its first contact, whether or not anyone is at work.
            expect((await listed("c1", d.id)).health.state).toBe("WAITING")
            // Written down by who added it; an agent's connection is how every terminal came until now, so it isn't said.
            expect(await audit(d.id)).toEqual([{ action: "ADD_ATTENDANCE_DEVICE", userId: "a1", details: { companyId: "c1", serialNumber: "SN-100", name: "Side gate", brand: "Convoy", mode: "ENTRANCE" } }])
        })

        it("is this one once an agent of the company reports its serial number, keeping its name, brand and mode", async () => {
            const before = (await db.query(`SELECT id FROM "AttendanceDevice" WHERE "companyId" = 'c1' AND "serialNumber" = 'SN-100'`)).rows[0].id as string
            const { code } = await Agents.create("c1", "Office", "a1")
            const { token } = await Agents.enrol(code, {})
            const agent = await Agents.authenticate(token) as AuthenticatedAgent
            const beat = await Devices.heartbeat(agent, { agentVersion: "0.2.0", queueDepth: 0, clock: new Date().toISOString(), devices: [{ serialNumber: "SN-100", name: "The agent's name for it", model: "CB 3000", reachable: true }] } as any)
            expect(beat.devices).toEqual([{ serialNumber: "SN-100", state: "ACTIVE", deviceId: before, mode: "ENTRANCE" }])
            expect(await count()).toBe(1)
            const d = await row(before)
            expect(d).toMatchObject({ name: "Side gate", brandId: convoy, mode: "ENTRANCE", model: "CB 3000", agentId: agent.id, addedById: "a1" })
            expect(d.lastSeenAt).not.toBeNull()
            expect((await listed("c1", before)).health.state).toBe("OK")
        })

        it("is a Hikvision terminal too, at a company whose switch is off as well (PR 301)", async () => {
            const added = await Devices.add("c2", { name: "Back gate", serialNumber: "HK-AGENT", brandId: hik, connection: "AGENT" }, "a2")
            expect(added.path).toBeNull()
            expect(added.device).toMatchObject({ name: "Back gate", serialNumber: "HK-AGENT", protocol: "HIKVISION", connection: "AGENT", brand: { id: hik, name: "Hikvision" } })
            expect(await row(added.device.id)).toMatchObject({ companyId: "c2", connection: "AGENT", protocol: "HIKVISION", brandId: hik, pushSecretHash: null, agentId: null })
            expect((await listed("c2", added.device.id)).health.state).toBe("WAITING")
        })
    })

    describe("straight to Nizmo", () => {
        let path = ""
        let id = ""

        it("is added with its address issued, returned once, and only the secret's hash kept", async () => {
            const added = await Devices.add("c1", { name: "Lobby", serialNumber: "HK-200", brandId: hik, connection: "DIRECT" }, "a1")
            path = added.path!
            id = added.device.id
            expect(path).toMatch(/^\/api\/terminals\/hikvision\/[A-Za-z0-9_-]{43}$/)
            expect(isPushSecret(secretOf(path))).toBe(true)
            const d = await row(id)
            expect(d).toMatchObject({ connection: "DIRECT", protocol: "HIKVISION", brandId: hik, mode: "ANY", addedById: "a1", lastSeenAt: null, lastAddress: null })
            expect(d.pushSecretHash).toBe(hashSecret(secretOf(path)))
            // What the list shows of it: waiting, and never the secret or its hash.
            const shown = await listed("c1", id)
            expect(shown).toMatchObject({ connection: "DIRECT", lastAddress: null, refusedCount: 0, lastRefusedAt: null, lastRefusal: null })
            expect(shown.health.state).toBe("WAITING")
            for (const kept of [JSON.stringify(shown), JSON.stringify(added.device), JSON.stringify(await audit(id))]) {
                expect(kept).not.toContain(secretOf(path))
                expect(kept).not.toContain(d.pushSecretHash)
            }
            expect(await audit(id)).toEqual([{ action: "ADD_ATTENDANCE_DEVICE", userId: "a1", details: { companyId: "c1", serialNumber: "HK-200", name: "Lobby", brand: "Hikvision", mode: "ANY", connection: "DIRECT" } }])
        })

        it("is heard at the address issued: its scan is stored, and where it called from is shown", async () => {
            const { status, from } = await call(path)
            expect(status).toBe(200)
            const { rows } = await db.query(`SELECT source, "hardwareUserId" FROM "AttendancePunch" WHERE "deviceId" = $1`, [id])
            expect(rows).toEqual([{ source: "DEVICE_PUSH", hardwareUserId: "7" }])
            const shown = await listed("c1", id)
            expect(shown.health.state).toBe("OK")
            expect(shown.lastAddress).toBe(from)
            expect(shown.lastSeenAt).not.toBeNull()
        })

        it("shows what was refused of its own scans, with the latest reason", async () => {
            expect((await call(path, "not an event")).status).toBe(200)
            expect(await listed("c1", id)).toMatchObject({ refusedCount: 1, lastRefusal: "UNREADABLE" })
            expect((await listed("c1", id)).lastRefusedAt).not.toBeNull()
        })

        it("gets a new address: the one it had stops at once, and the new one is answered", async () => {
            const issued = await Devices.issueAddress(id, "a1")
            expect(issued.path).toMatch(/^\/api\/terminals\/hikvision\/[A-Za-z0-9_-]{43}$/)
            expect(issued.path).not.toBe(path)
            expect(issued.device).toMatchObject({ id, name: "Lobby", connection: "DIRECT" })
            expect((await row(id)).pushSecretHash).toBe(hashSecret(secretOf(issued.path)))
            expect((await call(path)).status).toBe(404)
            expect((await call(issued.path)).status).toBe(200)
            const entries = await audit(id)
            expect(entries[entries.length - 1]).toEqual({ action: "ISSUE_TERMINAL_ADDRESS", userId: "a1", details: { companyId: "c1", name: "Lobby", serialNumber: "HK-200" } })
            expect(JSON.stringify(entries)).not.toContain(secretOf(issued.path))
            path = issued.path
        })

        it("gets a new address whether the company's switch is on or off: it only replaces a secret", async () => {
            await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = false WHERE id = 'c1'`)
            try {
                const issued = await Devices.issueAddress(id, "a1")
                // Off, the terminal is held either way (PR 291).
                expect((await call(issued.path)).status).toBe(403)
                expect((await call(path)).status).toBe(404)
                path = issued.path
            } finally {
                await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = true WHERE id = 'c1'`)
            }
            expect((await call(path)).status).toBe(200)
        })

        it("has no address to issue once retired, when it is the agent's, or when it isn't there", async () => {
            await expect(Devices.issueAddress("nope", "a1")).rejects.toThrow("DEVICE_NOT_FOUND")
            const agents = (await db.query(`SELECT id FROM "AttendanceDevice" WHERE "serialNumber" = 'SN-100'`)).rows[0].id as string
            await expect(Devices.issueAddress(agents, "a1")).rejects.toThrow("DEVICE_NO_ADDRESS")
            expect((await row(agents)).pushSecretHash).toBeNull()
            const hash = (await row(id)).pushSecretHash
            await Devices.retire(id, "a1")
            await expect(Devices.issueAddress(id, "a1")).rejects.toThrow("DEVICE_RETIRED")
            expect((await row(id)).pushSecretHash).toBe(hash)
            await Devices.restore(id, "a1")
        })
    })

    describe("what is refused", () => {
        it("is straight to Nizmo at a company whose switch is off, whatever the brand", async () => {
            const before = await count()
            // Every way is built for both protocols now, Hikvision's through the agent last (PR 301). ZKTeco's
            // straight to Nizmo asks for the office's address: lib/terminal-office-address.db.test.ts.
            await expect(Devices.add("c2", { name: "Gate", serialNumber: "HK-2", brandId: hik, connection: "DIRECT" }, "a2")).rejects.toThrow("DEVICE_DIRECT_NOT_ALLOWED")
            await expect(Devices.add("c2", { name: "Gate", serialNumber: "ZK-2", brandId: zk, connection: "DIRECT" }, "a2")).rejects.toThrow("DEVICE_DIRECT_NOT_ALLOWED")
            expect(await count()).toBe(before)
            expect(await Devices.directAllowed("c1")).toBe(true)
            expect(await Devices.directAllowed("c2")).toBe(false)
            expect(await Devices.directAllowed("nope")).toBe(false)
        })

        it("is a terminal with no name, no serial number, or a brand that isn't offered", async () => {
            const before = await count()
            await expect(Devices.add("c1", { name: "  ", serialNumber: "ZK-3", brandId: zk, connection: "AGENT" }, "a1")).rejects.toThrow("DEVICE_NAME_REQUIRED")
            await expect(Devices.add("c1", { name: "Gate", serialNumber: "  ", brandId: zk, connection: "AGENT" }, "a1")).rejects.toThrow("DEVICE_SERIAL_REQUIRED")
            await expect(Devices.add("c1", { name: "Gate", serialNumber: "ZK-3", brandId: "nope", connection: "AGENT" }, "a1")).rejects.toThrow("BRAND_NOT_FOUND")
            await db.query(`UPDATE "TerminalBrand" SET "retiredAt" = now() WHERE id = $1`, [zk])
            try {
                await expect(Devices.add("c1", { name: "Gate", serialNumber: "ZK-3", brandId: zk, connection: "AGENT" }, "a1")).rejects.toThrow("DEVICE_BRAND_RETIRED")
            } finally {
                await db.query(`UPDATE "TerminalBrand" SET "retiredAt" = NULL WHERE id = $1`, [zk])
            }
            expect(await count()).toBe(before)
        })

        it("is a serial number the company already has, retired or not", async () => {
            const before = await count()
            await expect(Devices.add("c1", { name: "Again", serialNumber: "SN-100", brandId: zk, connection: "AGENT" }, "a1")).rejects.toThrow("DEVICE_SERIAL_TAKEN")
            const { device } = await Devices.add("c1", { name: "Old door", serialNumber: "ZK-OLD", brandId: zk, connection: "AGENT" }, "a1")
            await Devices.retire(device.id, "a1")
            // Retired, it is restored, not added again: its punches and its history are that row's.
            await expect(Devices.add("c1", { name: "Old door", serialNumber: "ZK-OLD", brandId: zk, connection: "AGENT" }, "a1")).rejects.toThrow("DEVICE_SERIAL_TAKEN")
            expect(await count()).toBe(before + 1)
        })

        it("is a serial number in use at another company, until it is retired there", async () => {
            await expect(Devices.add("c2", { name: "Theirs", serialNumber: "SN-100", brandId: zk, connection: "AGENT" }, "a2")).rejects.toThrow("DEVICE_IN_USE_ELSEWHERE")
            // The first company's retired one is free for another to add.
            const added = await Devices.add("c2", { name: "Second-hand", serialNumber: "ZK-OLD", brandId: zk, connection: "AGENT" }, "a2")
            expect(await row(added.device.id)).toMatchObject({ companyId: "c2", serialNumber: "ZK-OLD", addedById: "a2" })
            // And then it can't come back to the first while it is in use there.
            const old = (await db.query(`SELECT id FROM "AttendanceDevice" WHERE "companyId" = 'c1' AND "serialNumber" = 'ZK-OLD'`)).rows[0].id as string
            await expect(Devices.restore(old, "a1")).rejects.toThrow("DEVICE_IN_USE_ELSEWHERE")
        })

        it("is the second of two adding the same serial number at the same moment", async () => {
            const before = await count()
            const both = await Promise.allSettled([
                Devices.add("c1", { name: "Door A", serialNumber: "ZK-RACE", brandId: zk, connection: "AGENT" }, "a1"),
                Devices.add("c1", { name: "Door B", serialNumber: "ZK-RACE", brandId: zk, connection: "AGENT" }, "a1"),
            ])
            expect(both.map(r => r.status).sort()).toEqual(["fulfilled", "rejected"])
            expect((both.find(r => r.status === "rejected") as PromiseRejectedResult).reason.message).toBe("DEVICE_SERIAL_TAKEN")
            expect(await count()).toBe(before + 1)
        })
    })
})
