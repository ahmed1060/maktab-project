import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceAgentService as Agents, type AuthenticatedAgent } from "@/lib/services/attendance-agent.service"
import { AttendanceDeviceService as Devices } from "@/lib/services/attendance-device.service"

/**
 * Local Sync Agents against a real Postgres built from the migrations
 * (ATTENDANCE_PLAN.md §17, Phase 2): enrolment with a one-time code, the
 * token that follows, its rotation, and revocation; then the terminals the
 * agents report in their heartbeats.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL);
`

describe.skipIf(!ADMIN_URL)("attendance agents, in Postgres", () => {
    const dbName = `agents_test_${Date.now()}`
    let db: Client

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
    }, 180_000)

    afterAll(async () => {
        vi.useRealTimers()
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const row = async (id: string) => (await db.query(`SELECT * FROM "AttendanceAgent" WHERE id = $1`, [id])).rows[0]

    it("adds an agent with a one-time code, kept only as a hash, and enrols it once", async () => {
        const { agent, code } = await Agents.create("c1", "  Head office ", "a1")
        expect(agent).toMatchObject({ name: "Head office", status: "PENDING" })
        expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
        const stored = await row(agent.id)
        expect(JSON.stringify(stored)).not.toContain(code)
        expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/)

        const enrolled = await Agents.enrol(code.toLowerCase().replace("-", " "), { hostname: "OFFICE-PC", agentVersion: "1.0.0" })
        expect(enrolled).toMatchObject({ agentId: agent.id, name: "Head office", company: "One" })
        expect(enrolled.token).toMatch(/^mka_/)
        const after = await row(agent.id)
        expect(after).toMatchObject({ status: "ACTIVE", codeHash: null, hostname: "OFFICE-PC", agentVersion: "1.0.0" })
        expect(JSON.stringify(after)).not.toContain(enrolled.token)
        // Once only.
        await expect(Agents.enrol(code, {})).rejects.toThrow("ENROLMENT_CODE_INVALID")
        expect(await Agents.authenticate(enrolled.token)).toEqual({ id: agent.id, companyId: "c1", name: "Head office", timeZone: expect.any(String) })
    })

    it("refuses a code that has run out, or never was, the same way", async () => {
        const { agent, code } = await Agents.create("c1", "Branch", "a1")
        await db.query(`UPDATE "AttendanceAgent" SET "codeExpiresAt" = now() - interval '1 minute' WHERE id = $1`, [agent.id])
        await expect(Agents.enrol(code, {})).rejects.toThrow("ENROLMENT_CODE_INVALID")
        await expect(Agents.enrol("AAAA-AAAA", {})).rejects.toThrow("ENROLMENT_CODE_INVALID")
        await expect(Agents.enrol("not a code", {})).rejects.toThrow("ENROLMENT_CODE_INVALID")
        // A new code works.
        const { code: again } = await Agents.reissueCode(agent.id, "a1")
        expect((await Agents.enrol(again, {})).agentId).toBe(agent.id)
    })

    it("lets one of two agents racing with the same code enrol", async () => {
        const { code } = await Agents.create("c1", "Race", "a1")
        const outcomes = await Promise.allSettled([Agents.enrol(code, { hostname: "A" }), Agents.enrol(code, { hostname: "B" })])
        expect(outcomes.map(o => o.status).sort()).toEqual(["fulfilled", "rejected"])
    })

    it("rotates a token without locking the agent out: the old one works until the new one is used", async () => {
        const { agent, code } = await Agents.create("c1", "Rotating", "a1")
        const { token: first } = await Agents.enrol(code, {})
        const me = await Agents.authenticate(first)
        if ("refused" in me) throw new Error("refused")
        const { token: second } = await Agents.rotate(me)
        // The reply could have been lost: the first still works.
        expect(await Agents.authenticate(first)).toMatchObject({ id: agent.id })
        expect(await Agents.authenticate(second)).toMatchObject({ id: agent.id })
        // Once the new one is used, the old one is gone.
        expect(await Agents.authenticate(first)).toEqual({ refused: "UNAUTHENTICATED" })
        expect(await Agents.authenticate(second)).toMatchObject({ id: agent.id })
    })

    it("moves an agent to a new PC with a new code: the old PC stops at once", async () => {
        const { agent, code } = await Agents.create("c1", "Moving", "a1")
        const { token: oldPc } = await Agents.enrol(code, { hostname: "OLD" })
        const { code: fresh } = await Agents.reissueCode(agent.id, "a1")
        // Until the new PC enrols, the old one carries on.
        expect(await Agents.authenticate(oldPc)).toMatchObject({ id: agent.id })
        const { token: newPc } = await Agents.enrol(fresh, { hostname: "NEW" })
        expect(await Agents.authenticate(oldPc)).toEqual({ refused: "UNAUTHENTICATED" })
        expect(await Agents.authenticate(newPc)).toMatchObject({ id: agent.id })
    })

    it("revokes: the token and any outstanding code stop working, and the agent stays listed", async () => {
        const { agent, code } = await Agents.create("c1", "Closing", "a1")
        const { token } = await Agents.enrol(code, {})
        const { code: pending } = await Agents.reissueCode(agent.id, "a1")
        await Agents.revoke(agent.id, "a1")
        expect(await Agents.authenticate(token)).toEqual({ refused: "UNAUTHENTICATED" })
        await expect(Agents.enrol(pending, {})).rejects.toThrow("ENROLMENT_CODE_INVALID")
        await expect(Agents.revoke(agent.id, "a1")).rejects.toThrow("AGENT_REVOKED")
        await expect(Agents.reissueCode(agent.id, "a1")).rejects.toThrow("AGENT_REVOKED")
        expect((await Agents.list("c1")).find(a => a.id === agent.id)).toMatchObject({ status: "REVOKED" })
        const { rows: audit } = await db.query(`SELECT action FROM "AuditLog" WHERE "entityId" = $1 ORDER BY "createdAt"`, [agent.id])
        expect(audit.map(a => a.action)).toEqual(["CREATE_ATTENDANCE_AGENT", "ENROL_ATTENDANCE_AGENT", "REISSUE_ATTENDANCE_AGENT_CODE", "REVOKE_ATTENDANCE_AGENT"])
    })

    it("refuses an agent whose company is banned, or no longer holds the Terminals add-on", async () => {
        const { code } = await Agents.create("c2", "Theirs", "a1")
        const { token } = await Agents.enrol(code, {})
        expect(await Agents.authenticate(token)).toMatchObject({ companyId: "c2" })
        await db.query(`INSERT INTO "Package"(id, name, "hasHR", "hasAttendanceMobile", "updatedAt") VALUES ('mobile', 'Mobile only', true, true, now())`)
        await db.query(`UPDATE "Company" SET "packageId" = 'mobile' WHERE id = 'c2'`)
        expect(await Agents.authenticate(token)).toEqual({ refused: "TERMINALS_NOT_INCLUDED" })
        await db.query(`UPDATE "Company" SET "packageId" = NULL, "isBanned" = true WHERE id = 'c2'`)
        expect(await Agents.authenticate(token)).toEqual({ refused: "COMPANY_BANNED" })
    })

    /** A fresh, enrolled agent of a company. */
    const agentOf = async (companyId: string, name: string) => {
        const { code } = await Agents.create(companyId, name, "a1")
        const { token } = await Agents.enrol(code, {})
        const me = await Agents.authenticate(token)
        if ("refused" in me) throw new Error(me.refused)
        return me as AuthenticatedAgent
    }
    const beat = (devices: object[], extra: object = {}) => ({ agentVersion: "1.2.0", queueDepth: 0, clock: new Date().toISOString(), devices, ...extra }) as any
    const device = async (companyId: string, serial: string) => (await db.query(`SELECT * FROM "AttendanceDevice" WHERE "companyId" = $1 AND "serialNumber" = $2`, [companyId, serial])).rows[0]

    it("brings a terminal in the first time an agent reports it, and keeps its health from each heartbeat", async () => {
        await db.query(`UPDATE "Company" SET "isBanned" = false, timezone = 'Africa/Cairo' WHERE id IN ('c1', 'c2')`)
        const office = await agentOf("c1", "Health")
        // The terminal's clock: two minutes ahead of the company's wall clock now.
        const ahead = new Date(Date.now() + 120_000 + (await import("@/lib/time")).offsetMsIn(new Date(), "Africa/Cairo")).toISOString().slice(0, 19)
        const first = await Devices.heartbeat(office, beat(
            [{ serialNumber: "SN-100", name: "Front door", model: "K40", reachable: true, clock: ahead, userCount: 40, recordCount: 9000, recordCapacity: 100000 }],
            { queueDepth: 12, clock: new Date(Date.now() - 30_000).toISOString(), hostname: "OFFICE-PC" },
        ))
        expect(first.devices).toEqual([{ serialNumber: "SN-100", state: "ACTIVE", deviceId: expect.any(String), mode: "ANY" }])
        expect(first.rotateToken).toBe(false)
        const d = await device("c1", "SN-100")
        expect(d).toMatchObject({ name: "Front door", model: "K40", reachable: true, userCount: 40, recordCount: 9000, recordCapacity: 100000, agentId: office.id })
        expect(Math.abs(d.clockDriftSeconds - 120)).toBeLessThan(5)
        const a = await row(office.id)
        expect(a).toMatchObject({ agentVersion: "1.2.0", queueDepth: 12, hostname: "OFFICE-PC" })
        expect(Math.abs(a.clockDriftSeconds + 30)).toBeLessThan(5)
        const { rows: added } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'ADD_ATTENDANCE_DEVICE' AND "entityId" = $1`, [d.id])
        expect(added[0].details).toMatchObject({ serialNumber: "SN-100", name: "Front door", agent: "Health" })

        // Out of reach: the error is kept, and when it was last seen is not moved.
        await Devices.heartbeat(office, beat([{ serialNumber: "SN-100", name: "Renamed by the agent", reachable: false, error: "timeout" }]))
        const later = await device("c1", "SN-100")
        expect(later).toMatchObject({ name: "Front door", reachable: false, lastError: "timeout", recordCount: 9000 })
        expect(later.lastSeenAt).toEqual(d.lastSeenAt)
    })

    it("lets one company use a terminal at a time; retired, another may bring it in", async () => {
        const one = await agentOf("c1", "One's agent")
        const two = await agentOf("c2", "Two's agent")
        await Devices.heartbeat(one, beat([{ serialNumber: "SN-200", reachable: true }]))
        expect((await Devices.heartbeat(two, beat([{ serialNumber: "SN-200", reachable: true }]))).devices[0]).toMatchObject({ state: "CLAIMED_ELSEWHERE", deviceId: null })
        expect(await device("c2", "SN-200")).toBeUndefined()
        const mine = await device("c1", "SN-200")
        expect(mine.name).toBe("Terminal SN-200")
        await Devices.retire(mine.id, "a1")
        // Retired here: one's agent is told so, and it is two's to bring in.
        expect((await Devices.heartbeat(one, beat([{ serialNumber: "SN-200", reachable: true }]))).devices[0].state).toBe("RETIRED")
        expect((await Devices.heartbeat(two, beat([{ serialNumber: "SN-200", reachable: true }]))).devices[0].state).toBe("ACTIVE")
        // And while two has it, one cannot have it back.
        await expect(Devices.restore(mine.id, "a1")).rejects.toThrow("DEVICE_IN_USE_ELSEWHERE")
        await expect(Devices.retire(mine.id, "a1")).rejects.toThrow("DEVICE_RETIRED")
        const theirs = await device("c2", "SN-200")
        await Devices.retire(theirs.id, "a1")
        await Devices.restore(mine.id, "a1")
        expect((await Devices.heartbeat(one, beat([{ serialNumber: "SN-200", reachable: true }]))).devices[0].state).toBe("ACTIVE")
        await expect(Devices.restore(mine.id, "a1")).rejects.toThrow("DEVICE_NOT_RETIRED")
    })

    it("is brought in once when two heartbeats report a new terminal at the same moment", async () => {
        const a = await agentOf("c1", "Twin A")
        const b = await agentOf("c1", "Twin B")
        const [x, y] = await Promise.all([Devices.heartbeat(a, beat([{ serialNumber: "SN-300", reachable: true }])), Devices.heartbeat(b, beat([{ serialNumber: "SN-300", reachable: true }]))])
        expect(x.devices[0].state).toBe("ACTIVE")
        expect(y.devices[0].state).toBe("ACTIVE")
        expect(x.devices[0].deviceId).toBe(y.devices[0].deviceId)
        expect((await db.query(`SELECT count(*)::int AS n FROM "AttendanceDevice" WHERE "serialNumber" = 'SN-300'`)).rows[0].n).toBe(1)
    })

    it("renames a terminal and changes its mode, audited; the agent hears the new mode", async () => {
        const agent = await agentOf("c1", "Modes")
        const [{ deviceId }] = (await Devices.heartbeat(agent, beat([{ serialNumber: "SN-400", reachable: true }]))).devices
        await expect(Devices.update(deviceId!, { name: "  " }, "a1")).rejects.toThrow("DEVICE_NAME_REQUIRED")
        expect(await Devices.update(deviceId!, { name: "Exit gate", mode: "EXIT" }, "a1")).toMatchObject({ name: "Exit gate", mode: "EXIT" })
        expect((await Devices.heartbeat(agent, beat([{ serialNumber: "SN-400", reachable: true }]))).devices[0].mode).toBe("EXIT")
        const { rows } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'UPDATE_ATTENDANCE_DEVICE' AND "entityId" = $1`, [deviceId])
        expect(rows[0].details).toMatchObject({ name: { from: "Terminal SN-400", to: "Exit gate" }, mode: { from: "ANY", to: "EXIT" } })
        expect((await Devices.list("c1")).map(d => d.serialNumber)).toContain("SN-400")
        expect((await Devices.list("c2")).map(d => d.serialNumber)).not.toContain("SN-400")
    })

    it("asks an agent to rotate a token a month old", async () => {
        const agent = await agentOf("c1", "Old token")
        await db.query(`UPDATE "AttendanceAgent" SET "tokenIssuedAt" = now() - interval '31 days' WHERE id = $1`, [agent.id])
        expect((await Devices.heartbeat(agent, beat([]))).rotateToken).toBe(true)
    })

    it("keeps a revoked agent from holding anything that works, at the database", async () => {
        const { agent } = await Agents.create("c1", "Checked", "a1")
        await expect(db.query(`UPDATE "AttendanceAgent" SET status = 'REVOKED', "revokedAt" = now() WHERE id = $1`, [agent.id])).rejects.toThrow(/AttendanceAgent_revoked/)
    })
})
