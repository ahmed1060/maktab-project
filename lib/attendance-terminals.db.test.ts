import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceAgentService as Agents, type AuthenticatedAgent } from "@/lib/services/attendance-agent.service"
import { AttendanceDeviceService as Devices } from "@/lib/services/attendance-device.service"
import { AttendanceIngestService as Ingest } from "@/lib/services/attendance-ingest.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * Local Sync Agents against a real Postgres built from the migrations
 * (ATTENDANCE_PLAN.md §17, Phase 2): enrolment with a one-time code, the
 * token that follows, its rotation, and revocation; then the terminals the
 * agents report in their heartbeats, and the punches they deliver.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
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

    it("keeps every token a rotation hands out working for a day, so rotations that overlap never lock the agent out (review on #17)", async () => {
        const { agent, code } = await Agents.create("c1", "Overlapping", "a1")
        const { token: first } = await Agents.enrol(code, {})
        const me = await Agents.authenticate(first)
        if ("refused" in me) throw new Error("refused")
        // A retry while the first rotation was still being written: the first one's write lands last.
        const { token: retry } = await Agents.rotate(me)
        const { token: earlier } = await Agents.rotate(me)
        // The agent kept the retry's answer: it works, and becomes its token.
        expect(await Agents.authenticate(retry)).toMatchObject({ id: agent.id })
        expect(await Agents.authenticate(first)).toEqual({ refused: "UNAUTHENTICATED" })
        // An answer it kept after that works too, and becomes its token in turn.
        expect(await Agents.authenticate(earlier)).toMatchObject({ id: agent.id })
        expect(await Agents.authenticate(retry)).toEqual({ refused: "UNAUTHENTICATED" })
        expect(await Agents.authenticate(earlier)).toMatchObject({ id: agent.id })
        expect((await row(agent.id)).tokenHash).not.toBeNull()
    })

    it("lets a token from a rotation lapse after a day unused, and keeps only a few waiting", async () => {
        const { PENDING_TOKEN_HOURS, MAX_PENDING_TOKENS } = await import("@/lib/services/attendance-agent.service")
        const { code } = await Agents.create("c1", "Lapsing", "a1")
        const { token: current } = await Agents.enrol(code, {})
        const me = await Agents.authenticate(current)
        if ("refused" in me) throw new Error("refused")
        const { token: stale } = await Agents.rotate(me)
        await db.query(`UPDATE "AttendanceAgentPendingToken" SET "createdAt" = now() - make_interval(hours => $2) WHERE "agentId" = $1`, [me.id, PENDING_TOKEN_HOURS + 1])
        expect(await Agents.authenticate(stale)).toEqual({ refused: "UNAUTHENTICATED" })
        // The current one is untouched.
        expect(await Agents.authenticate(current)).toMatchObject({ id: me.id })
        for (let i = 0; i < MAX_PENDING_TOKENS + 3; i++) await Agents.rotate(me)
        const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM "AttendanceAgentPendingToken" WHERE "agentId" = $1`, [me.id])
        expect(n).toBe(MAX_PENDING_TOKENS)
    })

    it("keeps only a few waiting when rotations overlap (review on #49)", async () => {
        const { MAX_PENDING_TOKENS } = await import("@/lib/services/attendance-agent.service")
        const { code } = await Agents.create("c1", "Overlapping", "a1")
        const me = await Agents.authenticate((await Agents.enrol(code, {})).token)
        if ("refused" in me) throw new Error("refused")
        for (let i = 0; i < MAX_PENDING_TOKENS; i++) await Agents.rotate(me)
        // Another rotation has written its token and not yet committed.
        await db.query("BEGIN")
        await db.query(`INSERT INTO "AttendanceAgentPendingToken"(id, "agentId", "tokenHash") VALUES ('overlap', $1, 'overlap-hash')`, [me.id])
        const rotating = Agents.rotate(me)
        await new Promise(r => setTimeout(r, 300))
        await db.query("COMMIT")
        await rotating
        const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM "AttendanceAgentPendingToken" WHERE "agentId" = $1`, [me.id])
        expect(n).toBe(MAX_PENDING_TOKENS)
    })

    it("moves an agent to a new PC with a new code: the old PC stops at once", async () => {
        const { agent, code } = await Agents.create("c1", "Moving", "a1")
        const { token: oldPc } = await Agents.enrol(code, { hostname: "OLD" })
        const me = await Agents.authenticate(oldPc)
        if ("refused" in me) throw new Error("refused")
        const { token: oldPcNext } = await Agents.rotate(me)
        const { code: fresh } = await Agents.reissueCode(agent.id, "a1")
        // Until the new PC enrols, the old one carries on.
        expect(await Agents.authenticate(oldPc)).toMatchObject({ id: agent.id })
        const { token: newPc } = await Agents.enrol(fresh, { hostname: "NEW" })
        expect(await Agents.authenticate(oldPc)).toEqual({ refused: "UNAUTHENTICATED" })
        // A token a rotation handed the old PC stops too.
        expect(await Agents.authenticate(oldPcNext)).toEqual({ refused: "UNAUTHENTICATED" })
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

    it("is not turned away as another company's when its own company brought it in a moment ago", async () => {
        // The race above, made certain: the other heartbeat commits the
        // terminal between this one looking for it in its own company (and
        // missing it) and looking for it anywhere else.
        const a = await agentOf("c1", "Late A")
        const b = await agentOf("c1", "Late B")
        await Devices.heartbeat(a, beat([{ serialNumber: "SN-310", reachable: true }]))
        const { prisma } = await import("@/lib/prisma")
        const lookup = vi.spyOn(prisma.attendanceDevice, "findUnique").mockResolvedValueOnce(null)
        try {
            const reply = await Devices.heartbeat(b, beat([{ serialNumber: "SN-310", reachable: true }]))
            expect(reply.devices[0]).toMatchObject({ state: "ACTIVE", deviceId: (await device("c1", "SN-310")).id })
        } finally {
            lookup.mockRestore()
        }
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

    it("stores the punches an agent delivers, once each, and rebuilds the days they touch", async () => {
        await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES ('s1', 'e1', 9300, '2026-01-01T00:00:00Z')`)
        await db.query(`INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES ('h1', 'e1', 'HIRED', '2026-01-01T00:00:00Z')`)
        await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: "2026-09-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-09-01", body: STANDARD_OFFICE }, "a1")
        await Punches.mapCode("c1", { code: "7", userId: "e1" }, "a1")
        const agent = await agentOf("c1", "Punches")
        await Devices.heartbeat(agent, beat([{ serialNumber: "IN-1", reachable: true }, { serialNumber: "OUT-1", reachable: true }]))
        const exitGate = await device("c1", "OUT-1")
        await Devices.update(exitGate.id, { mode: "EXIT" }, "a1")

        const batch = { punches: [
            { serialNumber: "IN-1", userNumber: "7", at: "2026-09-14T09:05:00" },
            { serialNumber: "OUT-1", userNumber: "7", at: "2026-09-14T17:02:00" },
            { serialNumber: "IN-1", userNumber: "7", at: "2026-09-14T09:05:00" },  // the same record twice in one batch
            { serialNumber: "IN-1", userNumber: "99", at: "2026-09-14T09:10:00" }, // nobody's number yet
        ] }
        expect(await Ingest.punches(agent, batch)).toEqual({ accepted: 3, duplicates: 1, refused: [] })
        // Sent again, as an agent that never heard back would: nothing new.
        expect(await Ingest.punches(agent, batch)).toEqual({ accepted: 0, duplicates: 4, refused: [] })

        const { rows } = await db.query(`SELECT source, "userId", "hardwareUserId", direction, "deviceId", to_char("punchAtLocal", 'YYYY-MM-DD"T"HH24:MI:SS') AS at FROM "AttendancePunch" WHERE "companyId" = 'c1' ORDER BY "punchAtLocal", "hardwareUserId"`)
        expect(rows).toEqual([
            { source: "AGENT", userId: "e1", hardwareUserId: "7", direction: null, deviceId: (await device("c1", "IN-1")).id, at: "2026-09-14T09:05:00" },
            { source: "AGENT", userId: null, hardwareUserId: "99", direction: null, deviceId: (await device("c1", "IN-1")).id, at: "2026-09-14T09:10:00" },
            { source: "AGENT", userId: "e1", hardwareUserId: "7", direction: "OUT", deviceId: exitGate.id, at: "2026-09-14T17:02:00" },
        ])
        // Listed with the terminal each came from.
        const listed = await Punches.list("c1", { from: "2026-09-14", to: "2026-09-14" }, { kind: "COMPANY" })
        expect(listed.map(p => [p.source, p.deviceName, p.direction])).toEqual([["AGENT", "Terminal OUT-1", "OUT"], ["AGENT", "Terminal IN-1", null]])
        // The day is built from them.
        const { rows: [day] } = await db.query(`SELECT status, "lateMinutes" FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-09-14'`)
        expect(day).toEqual({ status: "PRESENT", lateMinutes: 5 })
        expect((await device("c1", "OUT-1")).lastPunchAt).toEqual(new Date("2026-09-14T14:02:00Z"))
        expect((await row(agent.id)).lastSyncAt).not.toBeNull()

        // A mode changed later reinterprets nothing already stored.
        await Devices.update(exitGate.id, { mode: "ENTRANCE" }, "a1")
        expect((await db.query(`SELECT direction FROM "AttendancePunch" WHERE "deviceId" = $1`, [exitGate.id])).rows[0].direction).toBe("OUT")
    })

    it("says why it refused a punch, and whether sending it again could help", async () => {
        const agent = await agentOf("c1", "Refusals")
        await Devices.heartbeat(agent, beat([{ serialNumber: "R-1", reachable: true }, { serialNumber: "R-OLD", reachable: true }]))
        await Devices.retire((await device("c1", "R-OLD")).id, "a1")
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", year, month, status, "payrollDay", "updatedAt") VALUES ('aug', 'c1', 2026, 8, 'APPROVED', 25, now())`)
        const result = await Ingest.punches(agent, { punches: [
            { serialNumber: "R-NEW", userNumber: "7", at: "2026-09-15T09:00:00" },  // not reported yet
            { serialNumber: "R-OLD", userNumber: "7", at: "2026-09-15T09:00:00" },  // retired
            { serialNumber: "R-1", userNumber: "7", at: "2026-08-20T09:00:00" },    // August is paid
            { serialNumber: "R-1", userNumber: "7", at: "2099-01-01T09:00:00" },    // the terminal's clock is wrong
            { serialNumber: "R-1", userNumber: "7", at: "2026-09-15T09:00:00" },
            // A damaged record (a terminal packs months of 31 days): Date would make it 2 March (review on #17).
            { serialNumber: "R-1", userNumber: "7", at: "2026-02-30T09:00:00" },
        ] })
        expect(result).toEqual({
            accepted: 1, duplicates: 0,
            refused: [
                { index: 0, reason: "UNKNOWN_DEVICE", retry: true },
                { index: 1, reason: "DEVICE_RETIRED", retry: false },
                { index: 2, reason: "MONTH_LOCKED", retry: false },
                { index: 3, reason: "IN_FUTURE", retry: false },
                { index: 5, reason: "INVALID_TIME", retry: false },
            ],
        })
        // A check-out just after midnight on 1 September closes 31 August's night: August is locked, so it is refused too.
        await db.query(`INSERT INTO "AttendanceDay"(id, "companyId", "userId", date, status, "expectedEndMinutes", breakdown, "inputsHash") VALUES ('night', 'c1', 'e1', '2026-08-31', 'PRESENT', 1800, '{}', 'x')`)
        expect((await Ingest.punches(agent, { punches: [{ serialNumber: "R-1", userNumber: "7", at: "2026-09-01T05:30:00" }] })).refused).toEqual([{ index: 0, reason: "MONTH_LOCKED", retry: false }])
        // Another company's agent cannot deliver to this company's terminal.
        const theirs = await agentOf("c2", "Not yours")
        expect((await Ingest.punches(theirs, { punches: [{ serialNumber: "R-1", userNumber: "7", at: "2026-09-16T09:00:00" }] })).refused[0].reason).toBe("UNKNOWN_DEVICE")
    })

    it("holds a punch from a terminal hours fast until the company's clock reaches it (review on #17)", async () => {
        const { offsetMsIn } = await import("@/lib/time")
        const agent = await agentOf("c1", "Fast clock")
        await Devices.heartbeat(agent, beat([{ serialNumber: "FAST-1", reachable: true }]))
        const now = new Date()
        const local = (ms: number) => new Date(now.getTime() + offsetMsIn(now, agent.timeZone) + ms).toISOString().slice(0, 19)
        const twoHoursAhead = { serialNumber: "FAST-1", userNumber: "7", at: local(2 * 3_600_000) }
        const twoDaysAhead = { serialNumber: "FAST-1", userNumber: "7", at: local(48 * 3_600_000) }
        // Sent again next round, not dropped; a terminal whose date is wrong is refused for good.
        expect((await Ingest.punches(agent, { punches: [twoHoursAhead, twoDaysAhead] })).refused).toEqual([
            { index: 0, reason: "IN_FUTURE", retry: true },
            { index: 1, reason: "IN_FUTURE", retry: false },
        ])
        vi.useFakeTimers({ toFake: ["Date"], now: now.getTime() + 61 * 60_000 })
        try {
            expect(await Ingest.punches(agent, { punches: [twoHoursAhead] })).toMatchObject({ accepted: 1, refused: [] })
        } finally {
            vi.useRealTimers()
        }
    })

    it("says how each agent and terminal is doing, and which companies need attention first", async () => {
        const { terminalsOverview } = await import("@/lib/services/attendance-terminal-status")
        await db.query(`UPDATE "AttendanceAgent" SET status = 'REVOKED', "revokedAt" = now(), "codeHash" = NULL, "codeExpiresAt" = NULL, "tokenHash" = NULL WHERE status <> 'REVOKED'`)
        await db.query(`UPDATE "AttendanceDevice" SET "retiredAt" = now() WHERE "retiredAt" IS NULL`)
        const quiet = await agentOf("c1", "Quiet one")
        const fine = await agentOf("c2", "Fine one")
        await Devices.heartbeat(quiet, beat([{ serialNumber: "H-1", reachable: false, error: "timeout", recordCount: 95, recordCapacity: 100 }]))
        await Devices.heartbeat(fine, beat([{ serialNumber: "H-2", reachable: true }]))
        // Thursday 10:00 in Cairo: working hours. One agent last heard from an hour before.
        const thursday = new Date("2026-10-01T07:00:00Z")
        await db.query(`UPDATE "AttendanceAgent" SET "lastSeenAt" = $2 WHERE id = $1`, [quiet.id, new Date(thursday.getTime() - 3_600_000)])
        await db.query(`UPDATE "AttendanceAgent" SET "lastSeenAt" = $2 WHERE id = $1`, [fine.id, new Date(thursday.getTime() - 60_000)])
        await db.query(`UPDATE "AttendanceDevice" SET "lastSeenAt" = $1 WHERE "serialNumber" = 'H-2'`, [new Date(thursday.getTime() - 60_000)])
        const overview = await terminalsOverview(thursday)
        expect(overview.map(r => [r.name, r.tone, r.working])).toEqual([["One", "bad", true], ["Two", "ok", true]])
        expect(overview[0].agents.map(a => a.health)).toEqual(["SILENT"])
        expect(overview[0].terminals).toEqual({ total: 1, ok: 0, unreachable: 1, silent: 0, memoryFull: 1, clockOff: 0 })
        // Friday: a PC switched off is not an alarm.
        const friday = new Date("2026-10-02T07:00:00Z")
        await db.query(`UPDATE "AttendanceAgent" SET "lastSeenAt" = $2 WHERE id = $1`, [quiet.id, new Date(friday.getTime() - 3_600_000)])
        expect((await terminalsOverview(friday)).find(r => r.name === "One")!.agents[0].health).toBe("QUIET")
        // The company's own lists carry the same health.
        expect((await Agents.list("c1")).find(a => a.id === quiet.id)).toHaveProperty("health")
        expect((await Devices.list("c1")).find(d => d.serialNumber === "H-1")!.health).toMatchObject({ state: "UNREACHABLE", memoryFull: true })
    })

    it("keeps a revoked agent from holding anything that works, at the database", async () => {
        const { agent } = await Agents.create("c1", "Checked", "a1")
        await expect(db.query(`UPDATE "AttendanceAgent" SET status = 'REVOKED', "revokedAt" = now() WHERE id = $1`, [agent.id])).rejects.toThrow(/AttendanceAgent_revoked/)
        // A token from a rotation: only for an agent in use, and gone when it is revoked.
        await expect(db.query(`INSERT INTO "AttendanceAgentPendingToken"(id, "agentId", "tokenHash") VALUES ('pt-pending', $1, 'h-pending')`, [agent.id])).rejects.toThrow(/AttendanceAgentPendingToken_agent_active/)
        const used = await agentOf("c1", "Revoked with a token waiting")
        await Agents.rotate(used)
        await Agents.revoke(used.id, "a1")
        expect((await db.query(`SELECT count(*)::int AS n FROM "AttendanceAgentPendingToken" WHERE "agentId" = $1`, [used.id])).rows[0].n).toBe(0)
        await expect(db.query(`INSERT INTO "AttendanceAgentPendingToken"(id, "agentId", "tokenHash") VALUES ('pt-revoked', $1, 'h-revoked')`, [used.id])).rejects.toThrow(/AttendanceAgentPendingToken_agent_active/)
    })
})
