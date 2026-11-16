import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { hashSecret } from "@/lib/attendance/agent-credentials"
import { isPushSecret } from "@/lib/attendance/terminal-secrets"
import { AttendanceDeviceService as Devices } from "@/lib/services/attendance-device.service"
import { AttendanceAgentService as Agents, type AuthenticatedAgent } from "@/lib/services/attendance-agent.service"

/**
 * Change connection (ATTENDANCE_PLAN.md §17.6, §17.7, Phase 4 part 6,
 * PR 298), against a real Postgres built from the migrations: a ZKTeco
 * terminal an agent reads, moved straight to Nizmo and back; what stays
 * and what starts again; the agent's heartbeat and the terminal's own
 * calls either side of each move; and what is refused.
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

/** The office's own address, as Vercel says it, and another one. */
const OFFICE = "203.0.113.7"
const ELSEWHERE = "192.0.2.50"

describe.skipIf(!ADMIN_URL)("changing how a terminal connects, in Postgres", () => {
    const dbName = `terminal_move_test_${Date.now()}`
    let db: Client
    let zk = ""
    let agent: AuthenticatedAgent
    let dbUrl = ""

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
        dbUrl = url.toString()
        // The Super Admin has turned terminals straight to Nizmo on for the first company only (§17.8).
        await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = true WHERE id = 'c1'`)
        zk = (await db.query(`SELECT id FROM "TerminalBrand" WHERE name = 'ZKTeco'`)).rows[0].id
        const { code } = await Agents.create("c1", "Office", "a1")
        const { token } = await Agents.enrol(code, {})
        agent = await Agents.authenticate(token) as AuthenticatedAgent
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
    const audit = async (entityId: string) => (await db.query(`SELECT action, "userId", details FROM "AuditLog" WHERE "entityId" = $1 ORDER BY "createdAt"`, [entityId])).rows
    const listed = async (companyId: string, id: string) => (await Devices.list(companyId)).find(d => d.id === id)!

    /** What the agent says of a terminal at its heartbeat, its clock five minutes behind. */
    const beat = (serialNumber: string) => Devices.heartbeat(agent, {
        agentVersion: "0.2.0", queueDepth: 0, clock: new Date().toISOString(),
        devices: [{ serialNumber, model: "CB 3000", reachable: true, clock: new Date(Date.now() - 5 * 60_000 + 2 * 3_600_000).toISOString().slice(0, 19) }],
    } as any)

    /** A ZKTeco terminal's first call, as it makes it, from this address. */
    const firstCall = async (serial: string, from: string) => {
        const { GET } = await import("@/app/iclock/[...path]/route")
        const res = await GET(new Request(`https://nizmo.example/iclock/cdata?SN=${serial}&options=all`, { headers: { "x-vercel-forwarded-for": from } }))
        return { status: res.status, text: await res.text() }
    }

    /** A terminal the agent brought in, its brand picked. */
    async function readByTheAgent(serial: string, name: string) {
        const [reported] = (await beat(serial)).devices
        await Devices.update(reported.deviceId!, { name, mode: "ENTRANCE", brandId: zk }, "a1")
        return reported.deviceId!
    }

    describe("a ZKTeco terminal the agent reads, moved straight to Nizmo", () => {
        let id = ""

        it("is let in from the office's address, with nothing issued, and waits for its first contact", async () => {
            id = await readByTheAgent("ZK-300", "Front door")
            const before = await row(id)
            expect(before).toMatchObject({ connection: "AGENT", agentId: agent.id, reachable: true })
            expect(before.lastSeenAt).not.toBeNull()
            expect(before.clockDriftSeconds).not.toBeNull()

            const moved = await Devices.changeConnection(id, { connection: "DIRECT", officeAddresses: [` ${OFFICE} `, OFFICE, "198.51.100.0/28"] }, "a1")
            // Nothing to show once: what to set on it holds no secret.
            expect(moved.path).toBeNull()
            expect(moved.device).toMatchObject({ connection: "DIRECT", allowedAddresses: [OFFICE, "198.51.100.0/28"], name: "Front door", mode: "ENTRANCE" })

            const after = await row(id)
            // What it is stays: its name, brand, mode, when it was first seen, and the agent that last reported it.
            expect(after).toMatchObject({
                connection: "DIRECT", protocol: "ZKTECO", brandId: zk, name: "Front door", mode: "ENTRANCE", agentId: agent.id,
                allowedAddresses: [OFFICE, "198.51.100.0/28"], pushSecretHash: null, pushCursor: null, lastAddress: null,
                refusedCount: 0, lastRefusal: null, lastRefusedAt: null,
                // What the agent said of it is the agent's, and starts again: it hasn't called Nizmo yet.
                lastSeenAt: null, reachable: true, lastError: null, clockDriftSeconds: null,
            })
            expect(after.firstSeenAt).toEqual(before.firstSeenAt)
            expect((await listed("c1", id)).health.state).toBe("WAITING")
            expect((await audit(id)).at(-1)).toEqual({
                action: "UPDATE_ATTENDANCE_DEVICE", userId: "a1",
                details: { companyId: "c1", serialNumber: "ZK-300", name: "Front door", connection: { from: "AGENT", to: "DIRECT" }, officeAddresses: `${OFFICE}, 198.51.100.0/28` },
            })
        })

        it("is left alone by the agent from its next heartbeat, and answered when it calls from the office", async () => {
            expect((await beat("ZK-300")).devices).toEqual([{ serialNumber: "ZK-300", state: "DIRECT", deviceId: id, mode: null }])
            // Nothing the agent said of it is taken: it still waits.
            expect((await row(id)).lastSeenAt).toBeNull()
            expect((await firstCall("ZK-300", ELSEWHERE)).status).toBe(403)
            const answered = await firstCall("ZK-300", OFFICE)
            expect(answered.status).toBe(200)
            // Where it had got to starts again: it sends its whole memory.
            expect(answered.text).toContain("\nATTLOGStamp=0\n")
            const d = await row(id)
            expect(d.lastSeenAt).not.toBeNull()
            expect(d.lastAddress).toBe(OFFICE)
            expect((await listed("c1", id)).health.state).toBe("OK")
        })
    })

    describe("moved back to the agent", () => {
        let id = ""

        it("isn't taken from straight any more, and what belonged to straight to Nizmo starts again", async () => {
            id = (await db.query(`SELECT id FROM "AttendanceDevice" WHERE "serialNumber" = 'ZK-300'`)).rows[0].id
            // Where it had got to, and a call from elsewhere, noted while it was straight to Nizmo.
            await db.query(`UPDATE "AttendanceDevice" SET "pushCursor" = 'ATTLOG=500;OPERLOG=40' WHERE id = $1`, [id])
            await db.query(`DELETE FROM "RateLimit" WHERE key LIKE 'terminal-%'`)
            await firstCall("ZK-300", ELSEWHERE)
            const before = await row(id)
            expect(before.refusedCount).toBeGreaterThan(0)
            expect(before.lastRefusal).toBe(`ADDRESS_NOT_ALLOWED:${ELSEWHERE}`)

            const moved = await Devices.changeConnection(id, { connection: "AGENT" }, "a1")
            expect(moved.path).toBeNull()
            const after = await row(id)
            expect(after).toMatchObject({
                connection: "AGENT", allowedAddresses: [], pushSecretHash: null, pushCursor: null, lastAddress: null,
                refusedCount: 0, lastRefusal: null, lastRefusedAt: null, reachable: true, name: "Front door", mode: "ENTRANCE", agentId: agent.id,
            })
            // When it was last heard of stays, until the agent says again.
            expect(after.lastSeenAt).toEqual(before.lastSeenAt)
            expect((await audit(id)).at(-1)).toEqual({
                action: "UPDATE_ATTENDANCE_DEVICE", userId: "a1",
                details: { companyId: "c1", serialNumber: "ZK-300", name: "Front door", connection: { from: "DIRECT", to: "AGENT" } },
            })
        })

        it("is refused when it calls Nizmo itself, and read by the agent again", async () => {
            await db.query(`DELETE FROM "RateLimit" WHERE key LIKE 'terminal-%'`)
            expect(await firstCall("ZK-300", OFFICE)).toEqual({ status: 403, text: "" })
            // Nobody's, so nothing is noted on it.
            expect((await row(id)).refusedCount).toBe(0)
            expect((await beat("ZK-300")).devices).toEqual([{ serialNumber: "ZK-300", state: "ACTIVE", deviceId: id, mode: "ENTRANCE" }])
            expect((await row(id)).clockDriftSeconds).not.toBeNull()
            expect((await listed("c1", id)).health.state).toBe("OK")
        })

        it("moves to the agent with the company's switch off, which only narrows how scans come", async () => {
            const back = await Devices.changeConnection(id, { connection: "DIRECT", officeAddresses: [OFFICE] }, "a1")
            expect(back.device.connection).toBe("DIRECT")
            await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = false WHERE id = 'c1'`)
            try {
                expect((await Devices.changeConnection(id, { connection: "AGENT" }, "a1")).device.connection).toBe("AGENT")
                // And not straight to Nizmo again while it's off.
                await expect(Devices.changeConnection(id, { connection: "DIRECT", officeAddresses: [OFFICE] }, "a1")).rejects.toThrow("DEVICE_DIRECT_NOT_ALLOWED")
            } finally {
                await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = true WHERE id = 'c1'`)
            }
        })
    })

    describe("a Hikvision terminal", () => {
        it("set to the agent, moved straight to Nizmo, is issued its address, shown once, and moves back to the agent, its secret gone (PR 301)", async () => {
            const hik = (await db.query(`SELECT id FROM "TerminalBrand" WHERE name = 'Hikvision'`)).rows[0].id
            await db.query(
                `INSERT INTO "AttendanceDevice"(id, "companyId", "serialNumber", name, protocol, "brandId", connection, "addedById", "updatedAt") VALUES ('hik-1', 'c1', 'HK-1', 'Lobby', 'HIKVISION', $1, 'AGENT', 'a1', now())`,
                [hik],
            )
            await expect(Devices.changeConnection("hik-1", { connection: "DIRECT", officeAddresses: [OFFICE] }, "a1")).rejects.toThrow("DEVICE_NO_OFFICE_ADDRESS")
            const moved = await Devices.changeConnection("hik-1", { connection: "DIRECT" }, "a1")
            const secret = moved.path!.split("/").at(-1)!
            expect(isPushSecret(secret)).toBe(true)
            expect(await row("hik-1")).toMatchObject({ connection: "DIRECT", pushSecretHash: hashSecret(secret), allowedAddresses: [] })
            const back = await Devices.changeConnection("hik-1", { connection: "AGENT" }, "a1")
            expect(back.path).toBeNull()
            expect(await row("hik-1")).toMatchObject({ connection: "AGENT", protocol: "HIKVISION", brandId: hik, pushSecretHash: null, pushCursor: null })
            expect((await audit("hik-1")).at(-1)).toEqual({
                action: "UPDATE_ATTENDANCE_DEVICE", userId: "a1",
                details: { companyId: "c1", serialNumber: "HK-1", name: "Lobby", connection: { from: "DIRECT", to: "AGENT" } },
            })
        })
    })

    describe("a heartbeat at the moment it moves (review on PR 298)", () => {
        it("writes nothing over a move straight to Nizmo that commits after it read the terminal, and hears it's set straight to Nizmo", async () => {
            const id = await readByTheAgent("ZK-800", "Race gate")
            // The move holds the terminal's row, as changeConnection does, while the agent's heartbeat comes.
            const move = new Client({ connectionString: dbUrl })
            await move.connect()
            try {
                await move.query("BEGIN")
                await move.query(`SELECT id FROM "AttendanceDevice" WHERE id = $1 FOR UPDATE`, [id])
                const beating = beat("ZK-800")
                // The heartbeat has read the terminal as the agent's, and waits to write.
                const waiting = async () => Number((await db.query(`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)).rows[0].count)
                for (let i = 0; i < 100 && await waiting() === 0; i++) await new Promise(r => setTimeout(r, 50))
                expect(await waiting()).toBe(1)
                await move.query(`UPDATE "AttendanceDevice" SET "connection" = 'DIRECT', "allowedAddresses" = '{203.0.113.7}', "lastSeenAt" = NULL, "clockDriftSeconds" = NULL WHERE id = $1`, [id])
                await move.query("COMMIT")
                expect((await beating).devices).toEqual([{ serialNumber: "ZK-800", state: "DIRECT", deviceId: id, mode: null }])
            } finally {
                await move.end()
            }
            // Still waiting for its first contact: nothing the agent said of it was taken.
            expect(await row(id)).toMatchObject({ connection: "DIRECT", lastSeenAt: null, clockDriftSeconds: null })
            expect((await listed("c1", id)).health.state).toBe("WAITING")
        })
    })

    describe("what is refused", () => {
        it("is a terminal that isn't there, a retired one, or a move to the way it already connects", async () => {
            await expect(Devices.changeConnection("nobody", { connection: "AGENT" }, "a1")).rejects.toThrow("DEVICE_NOT_FOUND")
            const id = await readByTheAgent("ZK-400", "Gate")
            await expect(Devices.changeConnection(id, { connection: "AGENT" }, "a1")).rejects.toThrow("DEVICE_SAME_CONNECTION")
            await Devices.retire(id, "a1")
            await expect(Devices.changeConnection(id, { connection: "DIRECT", officeAddresses: [OFFICE] }, "a1")).rejects.toThrow("DEVICE_RETIRED")
            expect((await row(id)).connection).toBe("AGENT")
        })

        it("is straight to Nizmo with no office's address, one that isn't an address, too many, or one asked of a move to the agent", async () => {
            const id = await readByTheAgent("ZK-500", "Yard")
            const entries = await audit(id)
            const move = (officeAddresses?: string[]) => Devices.changeConnection(id, { connection: "DIRECT", officeAddresses }, "a1")
            await expect(move()).rejects.toThrow("DEVICE_OFFICE_ADDRESS_REQUIRED")
            await expect(move([" ", ""])).rejects.toThrow("DEVICE_OFFICE_ADDRESS_REQUIRED")
            await expect(move([OFFICE, "the office"])).rejects.toThrow("DEVICE_INVALID_OFFICE_ADDRESS")
            await expect(move(Array.from({ length: 21 }, (_, i) => `198.51.100.${i + 1}`))).rejects.toThrow("DEVICE_TOO_MANY_OFFICE_ADDRESSES")
            await move([OFFICE])
            await expect(Devices.changeConnection(id, { connection: "AGENT", officeAddresses: [OFFICE] }, "a1")).rejects.toThrow("DEVICE_NO_OFFICE_ADDRESS")
            // One move recorded, and nothing for those refused.
            expect((await audit(id)).length).toBe(entries.length + 1)
            expect((await row(id)).connection).toBe("DIRECT")
        })

        it("is straight to Nizmo where the company's switch is off", async () => {
            const { code } = await Agents.create("c2", "Their office", "a2")
            const { token } = await Agents.enrol(code, {})
            const theirs = await Agents.authenticate(token) as AuthenticatedAgent
            const [reported] = (await Devices.heartbeat(theirs, { agentVersion: "0.2.0", queueDepth: 0, clock: new Date().toISOString(), devices: [{ serialNumber: "ZK-600", reachable: true }] } as any)).devices
            await expect(Devices.changeConnection(reported.deviceId!, { connection: "DIRECT", officeAddresses: [OFFICE] }, "a2")).rejects.toThrow("DEVICE_DIRECT_NOT_ALLOWED")
            expect((await row(reported.deviceId!)).connection).toBe("AGENT")
        })

        it("is the second of two moves at once: one moves it, and the other finds it already moved", async () => {
            const id = await readByTheAgent("ZK-700", "Garage")
            const entries = (await audit(id)).length
            const results = await Promise.allSettled([1, 2].map(() => Devices.changeConnection(id, { connection: "DIRECT", officeAddresses: [OFFICE] }, "a1")))
            expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1)
            expect(results.filter(r => r.status === "rejected").map(r => String((r as PromiseRejectedResult).reason))).toEqual(["Error: DEVICE_SAME_CONNECTION"])
            expect((await audit(id)).length).toBe(entries + 1)
        })
    })
})
