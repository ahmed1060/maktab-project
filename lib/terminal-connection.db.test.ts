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
import { offsetMsIn } from "@/lib/time"

/**
 * One terminal whichever way it connects (ATTENDANCE_PLAN.md §17.6, Phase 4
 * part 4, PR 290), against a real Postgres built from the migrations: a scan
 * stored once across the agent and the terminal's own sending, one
 * connection at a time, and what a terminal's own scans are refused for.
 *
 * Nothing sets a terminal's connection or the company's switch yet (part 5
 * does), so the tests set them in the database.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, timezone, "updatedAt") VALUES ('c1', 'One', 'Africa/Cairo', now()), ('c2', 'Two', 'Africa/Cairo', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
`

/** What production could hold when the migration runs: a terminal, a scan the agent delivered, and two punches from elsewhere under one key. */
const BEFORE_CONNECTION = `
INSERT INTO "AttendanceDevice"(id, "companyId", "serialNumber", name, "firstSeenAt", "updatedAt") VALUES ('old', 'c1', 'OLD-1', 'Front door', '2026-08-15T10:00:00Z', now());
INSERT INTO "AttendancePunch"(id, "companyId", source, "sourceKey", "deviceId", "hardwareUserId", "punchAtLocal", "punchAt", "resolvedWithTimeZone") VALUES
 ('p-agent', 'c1', 'AGENT', 'old:7:2026-09-01T09:00:00', 'old', '7', '2026-09-01T09:00:00', '2026-09-01T06:00:00Z', 'Africa/Cairo'),
 ('p-mobile', 'c1', 'MOBILE', 'same-key', NULL, '31', '2026-09-01T09:01:00', '2026-09-01T06:01:00Z', 'Africa/Cairo'),
 ('p-manual', 'c1', 'MANUAL', 'same-key', NULL, '31', '2026-09-01T09:02:00', '2026-09-01T06:02:00Z', 'Africa/Cairo');
`

describe.skipIf(!ADMIN_URL)("one terminal whichever way it connects, in Postgres", () => {
    const dbName = `terminal_connection_test_${Date.now()}`
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
            if (m.endsWith("_terminal_connection")) await db.query(BEFORE_CONNECTION)
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(BEFORE_ROLES)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()

        // Ehab works 09:00 to 17:00 and is number 7 on the terminals.
        await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES ('s1', 'e1', 9300, '2026-01-01T00:00:00Z')`)
        await db.query(`INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES ('h1', 'e1', 'HIRED', '2026-01-01T00:00:00Z')`)
        await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: "2026-08-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-08-01", body: STANDARD_OFFICE }, "a1")
        await Punches.mapCode("c1", { code: "7", userId: "e1" }, "a1")
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

    const device = async (id: string) => (await db.query(`SELECT * FROM "AttendanceDevice" WHERE id = $1`, [id])).rows[0]
    /** A terminal as part 5 will add one: by hand, with its connection. */
    const terminal = async (id: string, companyId = "c1", connection: "AGENT" | "DIRECT" = "DIRECT", mode = "ANY") => {
        await db.query(`INSERT INTO "AttendanceDevice"(id, "companyId", "serialNumber", name, connection, mode, "updatedAt") VALUES ($1, $2, $1, $1, $3::"TerminalConnection", $4::"DeviceMode", now())`, [id, companyId, connection, mode])
        return id
    }
    const allow = (companyId: string, on = true) => db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = $2 WHERE id = $1`, [companyId, on])
    const connect = (id: string, connection: "AGENT" | "DIRECT") => db.query(`UPDATE "AttendanceDevice" SET connection = $2::"TerminalConnection" WHERE id = $1`, [id, connection])
    const punchesOf = async (deviceId: string) => (await db.query(
        `SELECT source, "sourceKey", "userId", "hardwareUserId", direction, to_char("punchAtLocal", 'YYYY-MM-DD"T"HH24:MI:SS') AS at, "punchAt" FROM "AttendancePunch" WHERE "deviceId" = $1 ORDER BY "punchAtLocal", "hardwareUserId"`, [deviceId],
    )).rows
    const agentOf = async (companyId: string, name: string) => {
        const { code } = await Agents.create(companyId, name, "a1")
        const { token } = await Agents.enrol(code, {})
        const me = await Agents.authenticate(token)
        if ("refused" in me) throw new Error(me.refused)
        return me as AuthenticatedAgent
    }
    const beat = (devices: object[]) => ({ agentVersion: "0.2.0", queueDepth: 0, clock: new Date().toISOString(), devices }) as never
    const allRefused = (count: number, reason: string) => ({ accepted: 0, duplicates: 0, skipped: 0, refused: Array.from({ length: count }, (_, index) => ({ index, reason })) })

    describe("the migration", () => {
        it("keeps every terminal through the agent, with nothing refused and no secret, and the switch off", async () => {
            expect(await device("old")).toMatchObject({
                connection: "AGENT", pushSecretHash: null, allowedAddresses: [], pushCursor: null, lastAddress: null,
                refusedCount: 0, lastRefusedAt: null, lastRefusal: null, addedById: null,
            })
            const { rows } = await db.query(`SELECT id, "terminalsDirectAllowed" FROM "Company" ORDER BY id`)
            expect(rows).toEqual([{ id: "c1", terminalsDirectAllowed: false }, { id: "c2", terminalsDirectAllowed: false }])
            // What was there is still there.
            expect((await db.query(`SELECT id FROM "AttendancePunch" ORDER BY id`)).rows.map(r => r.id)).toEqual(["p-agent", "p-manual", "p-mobile"])
        })

        it("lets a scan in once across the agent and the terminal, at the database", async () => {
            const insert = (id: string, companyId: string, source: string, key: string) => db.query(
                `INSERT INTO "AttendancePunch"(id, "companyId", source, "sourceKey", "hardwareUserId", "punchAtLocal", "punchAt", "resolvedWithTimeZone") VALUES ($1, $2, $3::"PunchSource", $4, '31', '2026-09-01T09:00:00', '2026-09-01T06:00:00Z', 'Africa/Cairo')`, [id, companyId, source, key],
            )
            // The scan the agent delivered, arriving from the terminal itself.
            await expect(insert("again", "c1", "DEVICE_PUSH", "old:7:2026-09-01T09:00:00")).rejects.toMatchObject({ code: "23505", constraint: "AttendancePunch_terminal_scan_once" })
            // Another company's terminal is another terminal; and the other sources' keys are their own.
            await insert("theirs", "c2", "DEVICE_PUSH", "old:7:2026-09-01T09:00:00")
            await insert("typed", "c1", "IMPORT", "old:7:2026-09-01T09:00:00")
            await db.query(`DELETE FROM "AttendancePunch" WHERE id IN ('theirs', 'typed')`)
        })
    })

    describe("a terminal's own scans", () => {
        it("are refused while the company's switch is off, while it's set to the agent, and once it's retired, each counted on the terminal", async () => {
            const scans = [{ userNumber: "7", at: "2026-09-02T09:00:00" }, { userNumber: "7", at: "2026-09-02T17:00:00" }]
            const id = await terminal("gate")

            expect(await Ingest.fromTerminal(id, scans)).toEqual(allRefused(2, "DIRECT_NOT_ALLOWED"))
            expect(await device(id)).toMatchObject({ refusedCount: 2, lastRefusal: "DIRECT_NOT_ALLOWED" })
            expect((await device(id)).lastRefusedAt).toBeInstanceOf(Date)

            await allow("c1")
            await connect(id, "AGENT")
            expect(await Ingest.fromTerminal(id, scans)).toEqual(allRefused(2, "DEVICE_VIA_AGENT"))
            expect(await device(id)).toMatchObject({ refusedCount: 4, lastRefusal: "DEVICE_VIA_AGENT" })

            await connect(id, "DIRECT")
            await Devices.retire(id, "a1")
            expect(await Ingest.fromTerminal(id, scans)).toEqual(allRefused(2, "DEVICE_RETIRED"))
            expect(await device(id)).toMatchObject({ refusedCount: 6, lastRefusal: "DEVICE_RETIRED" })

            expect(await punchesOf(id)).toEqual([])
            // A request with nothing in it counts nothing; and one for no terminal there is isn't answered at all.
            expect(await Ingest.fromTerminal(id, [])).toEqual(allRefused(0, "DEVICE_RETIRED"))
            expect((await device(id)).refusedCount).toBe(6)
            await expect(Ingest.fromTerminal("nobody", scans)).rejects.toThrow("DEVICE_NOT_FOUND")
        })

        it("are stored once each as the terminal's, for the person its number is mapped to, and their days worked out", async () => {
            const entrance = await terminal("entrance", "c1", "DIRECT", "ENTRANCE")
            const exit = await terminal("exit", "c1", "DIRECT", "EXIT")
            const morning = [
                { userNumber: "7", at: "2026-09-14T09:05:00" },
                { userNumber: "7", at: "2026-09-14T09:05:00" },  // the same record twice in one request
                { userNumber: "99", at: "2026-09-14T09:10:00" }, // nobody's number yet
            ]
            expect(await Ingest.fromTerminal(entrance, morning)).toEqual({ accepted: 2, duplicates: 1, skipped: 0, refused: [] })
            expect(await Ingest.fromTerminal(exit, [{ userNumber: "7", at: "2026-09-14T17:02:00" }])).toEqual({ accepted: 1, duplicates: 0, skipped: 0, refused: [] })
            // Sent again, as a terminal that never heard back would: nothing new.
            expect(await Ingest.fromTerminal(entrance, morning)).toEqual({ accepted: 0, duplicates: 3, skipped: 0, refused: [] })

            expect(await punchesOf(entrance)).toEqual([
                { source: "DEVICE_PUSH", sourceKey: "entrance:7:2026-09-14T09:05:00", userId: "e1", hardwareUserId: "7", direction: "IN", at: "2026-09-14T09:05:00", punchAt: new Date("2026-09-14T06:05:00Z") },
                { source: "DEVICE_PUSH", sourceKey: "entrance:99:2026-09-14T09:10:00", userId: null, hardwareUserId: "99", direction: "IN", at: "2026-09-14T09:10:00", punchAt: new Date("2026-09-14T06:10:00Z") },
            ])
            expect((await punchesOf(exit)).map(p => p.direction)).toEqual(["OUT"])
            expect((await device(exit)).lastPunchAt).toEqual(new Date("2026-09-14T14:02:00Z"))
            expect(await device(entrance)).toMatchObject({ refusedCount: 0, lastRefusal: null })
            const { rows: [day] } = await db.query(`SELECT status, "lateMinutes" FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-09-14'`)
            expect(day).toEqual({ status: "PRESENT", lateMinutes: 5 })
            // Listed with the terminal each came from, like the agent's.
            const listed = await Punches.list("c1", { from: "2026-09-14", to: "2026-09-14" }, { kind: "COMPANY" })
            expect(listed.map(p => [p.source, p.deviceName, p.direction])).toEqual([["DEVICE_PUSH", "exit", "OUT"], ["DEVICE_PUSH", "entrance", "IN"]])
        })

        it("are skipped from before the month the company's first terminal was seen, and never counted as refused", async () => {
            // The company's first terminal was seen on 15 August 2026: its terminals start on 1 August.
            const id = await terminal("memory")
            expect(await Ingest.fromTerminal(id, [
                { userNumber: "7", at: "2024-03-10T09:00:00" },
                { userNumber: "7", at: "2026-07-31T23:59:59" },
                { userNumber: "7", at: "2026-08-01T00:00:00" },
            ])).toEqual({ accepted: 1, duplicates: 0, skipped: 2, refused: [] })
            expect((await punchesOf(id)).map(p => p.at)).toEqual(["2026-08-01T00:00:00"])
            expect((await device(id)).refusedCount).toBe(0)

            // The month is the company's own: 22:30 on 31 August in UTC is already 1 September in Cairo.
            await allow("c2")
            const theirs = await terminal("theirs", "c2")
            await db.query(`UPDATE "AttendanceDevice" SET "firstSeenAt" = '2026-08-31T22:30:00Z' WHERE id = 'theirs'`)
            expect(await Ingest.fromTerminal(theirs, [{ userNumber: "7", at: "2026-08-31T23:00:00" }, { userNumber: "7", at: "2026-09-01T00:30:00" }])).toMatchObject({ accepted: 1, skipped: 1 })
            // And another company's number 7 is nobody here.
            expect((await punchesOf(theirs)).map(p => [p.at, p.userId])).toEqual([["2026-09-01T00:30:00", null]])
        })

        it("are refused one by one, each for its reason, with the latest kept on the terminal", async () => {
            await db.query(`INSERT INTO "PayrollRun"(id, "companyId", year, month, status, "payrollDay", "updatedAt") VALUES ('aug', 'c1', 2026, 8, 'APPROVED', 25, now())`)
            const id = await terminal("refusals")
            const result = await Ingest.fromTerminal(id, [
                { userNumber: "7", at: "2026-08-20T09:00:00" },  // August is paid
                { userNumber: "7", at: "2026-09-15T09:00:00" },
                { userNumber: "7", at: "2026-02-30T09:00:00" },  // a damaged record: no calendar has it
                { userNumber: "7", at: "2026-09-15 17:00:00" },  // not a wall-clock time as Nizmo keeps one
                { userNumber: "7", at: "2099-01-01T09:00:00" },  // the terminal's clock is wrong
            ])
            expect(result).toEqual({
                accepted: 1, duplicates: 0, skipped: 0,
                refused: [
                    { index: 0, reason: "MONTH_LOCKED" },
                    { index: 2, reason: "INVALID_TIME" },
                    { index: 3, reason: "INVALID_TIME" },
                    { index: 4, reason: "IN_FUTURE" },
                ],
            })
            expect(await device(id)).toMatchObject({ refusedCount: 4, lastRefusal: "IN_FUTURE" })
            const first = (await device(id)).lastRefusedAt as Date
            expect(first).toBeInstanceOf(Date)

            // A check-out just after midnight on 1 September closes 31 August's night: August is paid, so it's refused too.
            await db.query(`INSERT INTO "AttendanceDay"(id, "companyId", "userId", date, status, "expectedStartMinutes", "expectedEndMinutes", breakdown, "inputsHash") VALUES ('night', 'c1', 'e1', '2026-08-31', 'PRESENT', 1320, 1800, '{}', 'x')
                ON CONFLICT ("companyId", "userId", date) DO UPDATE SET "expectedStartMinutes" = 1320, "expectedEndMinutes" = 1800`)
            expect((await Ingest.fromTerminal(id, [{ userNumber: "7", at: "2026-09-01T05:30:00" }])).refused).toEqual([{ index: 0, reason: "MONTH_LOCKED" }])
            expect(await device(id)).toMatchObject({ refusedCount: 5, lastRefusal: "MONTH_LOCKED" })

            // A request with nothing refused leaves the count, the reason and its time as they were.
            const before = await device(id)
            expect(await Ingest.fromTerminal(id, [{ userNumber: "7", at: "2026-09-15T17:00:00" }])).toMatchObject({ accepted: 1, refused: [] })
            expect(await device(id)).toMatchObject({ refusedCount: 5, lastRefusal: "MONTH_LOCKED", lastRefusedAt: before.lastRefusedAt })
        })

        it("are taken up to 60 minutes ahead of the company's clock, and refused for good past that", async () => {
            const id = await terminal("fast")
            const now = new Date()
            const local = (ms: number) => new Date(now.getTime() + offsetMsIn(now, "Africa/Cairo") + ms).toISOString().slice(0, 19)
            const halfAnHourAhead = { userNumber: "41", at: local(30 * 60_000) }
            const twoHoursAhead = { userNumber: "41", at: local(2 * 3_600_000) }
            vi.useFakeTimers({ toFake: ["Date"], now: now.getTime() })
            try {
                // Unlike the agent, a terminal can't hold a scan and offer it again: there's nothing to retry.
                expect(await Ingest.fromTerminal(id, [halfAnHourAhead, twoHoursAhead])).toEqual({ accepted: 1, duplicates: 0, skipped: 0, refused: [{ index: 1, reason: "IN_FUTURE" }] })
            } finally {
                vi.useRealTimers()
            }
            expect((await punchesOf(id)).map(p => p.at)).toEqual([halfAnHourAhead.at])
        })
    })

    describe("across both ways", () => {
        it("stores a scan once, whichever way it came first", async () => {
            const agent = await agentOf("c1", "Office PC")
            const [{ deviceId }] = (await Devices.heartbeat(agent, beat([{ serialNumber: "BOTH-1", reachable: true }]))).devices
            const id = deviceId!
            const scan = (time: string) => ({ userNumber: "7", at: `2026-09-21T${time}` })
            const fromAgent = (...times: string[]) => Ingest.punches(agent, { punches: times.map(t => ({ serialNumber: "BOTH-1", ...scan(t) })) })

            // The agent delivers the morning; then the terminal is set straight to Nizmo and sends its whole memory.
            expect(await fromAgent("09:00:00")).toEqual({ accepted: 1, duplicates: 0, refused: [] })
            await connect(id, "DIRECT")
            expect(await Ingest.fromTerminal(id, [scan("09:00:00"), scan("13:00:00")])).toEqual({ accepted: 1, duplicates: 1, skipped: 0, refused: [] })

            // What the agent read before it heard of the change is still taken, each scan once.
            expect(await fromAgent("09:00:00", "13:00:00", "17:00:00")).toEqual({ accepted: 1, duplicates: 2, refused: [] })
            expect(await Ingest.fromTerminal(id, [scan("17:00:00")])).toEqual({ accepted: 0, duplicates: 1, skipped: 0, refused: [] })

            expect((await punchesOf(id)).map(p => [p.at.slice(11), p.source])).toEqual([["09:00:00", "AGENT"], ["13:00:00", "DEVICE_PUSH"], ["17:00:00", "AGENT"]])
            const { rows: [day] } = await db.query(`SELECT status, "firstInAt", "lastOutAt" FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-09-21'`)
            // The day is read from all three, on the company's wall clock, whichever way each came.
            expect(day).toEqual({ status: "PRESENT", firstInAt: new Date("2026-09-21T09:00:00Z"), lastOutAt: new Date("2026-09-21T17:00:00Z") })
        })

        it("keeps its event on the terminal's own new scan only: the agent's keeps none, and one already there stays as it is (PR 293)", async () => {
            const agent = await agentOf("c1", "Office PC")
            const [{ deviceId }] = (await Devices.heartbeat(agent, beat([{ serialNumber: "KEPT-1", reachable: true }]))).devices
            const id = deviceId!
            const scan = (time: string) => ({ userNumber: "7", at: `2026-09-28T${time}` })
            const kept = (time: string) => ({ ...scan(time), kept: { dateTime: `2026-09-28T${time}+03:00`, AccessControllerEvent: { employeeNoString: "7" } } })
            expect(await Ingest.punches(agent, { punches: [{ serialNumber: "KEPT-1", ...scan("09:00:00") }] })).toEqual({ accepted: 1, duplicates: 0, refused: [] })
            await connect(id, "DIRECT")
            // The terminal sends its memory: the morning is there already, the afternoon is new.
            expect(await Ingest.fromTerminal(id, [kept("09:00:00"), kept("13:00:00"), scan("17:00:00")])).toEqual({ accepted: 2, duplicates: 1, skipped: 0, refused: [] })
            const { rows } = await db.query(`SELECT to_char("punchAtLocal", 'HH24:MI:SS') AS at, source, "rawPayload" FROM "AttendancePunch" WHERE "deviceId" = $1 ORDER BY "punchAtLocal"`, [id])
            expect(rows).toEqual([
                { at: "09:00:00", source: "AGENT", rawPayload: null },
                { at: "13:00:00", source: "DEVICE_PUSH", rawPayload: { dateTime: "2026-09-28T13:00:00+03:00", AccessControllerEvent: { employeeNoString: "7" } } },
                // A scan with nothing to keep is stored the same, with none.
                { at: "17:00:00", source: "DEVICE_PUSH", rawPayload: null },
            ])
        })

        it("answers a scan it holds as already there even once its month is paid, and refuses only what is new", async () => {
            const agent = await agentOf("c1", "Whole memory PC")
            const [{ deviceId }] = (await Devices.heartbeat(agent, beat([{ serialNumber: "MEM-1", reachable: true }]))).devices
            const id = deviceId!
            const scan = (time: string) => ({ userNumber: "7", at: `2026-10-05T${time}` })
            const fromAgent = (...times: string[]) => Ingest.punches(agent, { punches: times.map(t => ({ serialNumber: "MEM-1", ...scan(t) })) })
            expect(await fromAgent("09:00:00", "17:00:00")).toMatchObject({ accepted: 2 })
            await db.query(`INSERT INTO "PayrollRun"(id, "companyId", year, month, status, "payrollDay", "updatedAt") VALUES ('oct', 'c1', 2026, 10, 'APPROVED', 25, now())`)
            try {
                // Set straight to Nizmo, the terminal sends its whole memory: what's held isn't a refusal on its card.
                await connect(id, "DIRECT")
                expect(await Ingest.fromTerminal(id, [scan("09:00:00"), scan("17:00:00"), scan("18:30:00")])).toEqual({ accepted: 0, duplicates: 2, skipped: 0, refused: [{ index: 2, reason: "MONTH_LOCKED" }] })
                expect(await device(id)).toMatchObject({ refusedCount: 1, lastRefusal: "MONTH_LOCKED" })
                // The same for an agent that reads the log again from its start.
                expect(await fromAgent("09:00:00", "17:00:00", "18:30:00")).toEqual({ accepted: 0, duplicates: 2, refused: [{ index: 2, reason: "MONTH_LOCKED", retry: false }] })
                expect((await punchesOf(id)).map(p => p.at.slice(11))).toEqual(["09:00:00", "17:00:00"])
            } finally {
                await db.query(`DELETE FROM "PayrollRun" WHERE id = 'oct'`)
            }
        })

        it("stores each scan once when both send the same ones at the same moment", async () => {
            const agent = await agentOf("c1", "Racing PC")
            const [{ deviceId }] = (await Devices.heartbeat(agent, beat([{ serialNumber: "RACE-1", reachable: true }]))).devices
            await connect(deviceId!, "DIRECT")
            const scans = Array.from({ length: 20 }, (_, i) => ({ userNumber: String(100 + i), at: `2026-09-22T09:${String(i).padStart(2, "0")}:00` }))
            const [a, t] = await Promise.all([
                Ingest.punches(agent, { punches: scans.map(s => ({ serialNumber: "RACE-1", ...s })) }),
                Ingest.fromTerminal(deviceId!, scans),
            ])
            expect(a.accepted + t.accepted).toBe(20)
            expect(a.duplicates + t.duplicates).toBe(20)
            expect(await punchesOf(deviceId!)).toHaveLength(20)
        })
    })

    describe("the agent's heartbeat", () => {
        it("hears DIRECT for a terminal straight to Nizmo, and nothing it says of it is taken", async () => {
            const agent = await agentOf("c1", "Reporting PC")
            const other = await agentOf("c1", "Second PC")
            const report = { serialNumber: "HB-1", name: "Side door", model: "K40", reachable: true, userCount: 40, recordCount: 900, recordCapacity: 100000 }
            const [{ deviceId }] = (await Devices.heartbeat(agent, beat([report]))).devices
            const id = deviceId!
            await Devices.update(id, { mode: "EXIT" }, "a1")
            await connect(id, "DIRECT")
            const before = await device(id)

            const reply = await Devices.heartbeat(other, beat([{ ...report, model: "Other", reachable: false, error: "timeout", recordCount: 5 }]))
            expect(reply.devices).toEqual([{ serialNumber: "HB-1", state: "DIRECT", deviceId: id, mode: null }])
            const after = await device(id)
            for (const column of ["agentId", "model", "reachable", "lastError", "recordCount", "userCount", "lastSeenAt", "clockDriftSeconds", "updatedAt"]) expect(after[column], column).toEqual(before[column])

            // Retired, it's retired first; set back to the agent, it's the agent's again.
            await Devices.retire(id, "a1")
            expect((await Devices.heartbeat(other, beat([report]))).devices[0].state).toBe("RETIRED")
            await Devices.restore(id, "a1")
            expect((await Devices.heartbeat(other, beat([report]))).devices[0].state).toBe("DIRECT")
            await connect(id, "AGENT")
            expect((await Devices.heartbeat(other, beat([{ ...report, recordCount: 950 }]))).devices).toEqual([{ serialNumber: "HB-1", state: "ACTIVE", deviceId: id, mode: "EXIT" }])
            expect(await device(id)).toMatchObject({ agentId: other.id, recordCount: 950, reachable: true })
        })
    })

    describe("the protocol the agent read it with (PR 301)", () => {
        const brandId = async (name: string) => (await db.query(`SELECT id FROM "TerminalBrand" WHERE name = $1`, [name])).rows[0].id as string
        const protocolChanges = async (id: string) => (await db.query(
            `SELECT details FROM "AuditLog" WHERE "entityId" = $1 AND action = 'UPDATE_ATTENDANCE_DEVICE' AND details ? 'protocol' ORDER BY "createdAt"`, [id],
        )).rows.map(r => r.details)

        it("is a terminal's when it's first reported, ZKTeco's from an agent that says none, with no brand", async () => {
            const agent = await agentOf("c1", "First sight PC")
            const reply = await Devices.heartbeat(agent, beat([
                { serialNumber: "PROTO-ZK", reachable: true },
                { serialNumber: "PROTO-HIK", reachable: true, protocol: "HIKVISION" },
                { serialNumber: "PROTO-AWAY", reachable: false, error: "HIK_UNREACHABLE: no answer", protocol: "HIKVISION" },
            ]))
            expect(reply.devices.map(d => d.state)).toEqual(["ACTIVE", "ACTIVE", "ACTIVE"])
            for (const [serial, protocol] of [["PROTO-ZK", "ZKTECO"], ["PROTO-HIK", "HIKVISION"], ["PROTO-AWAY", "HIKVISION"]]) {
                const row = (await db.query(`SELECT protocol::text, "brandId" FROM "AttendanceDevice" WHERE "serialNumber" = $1`, [serial])).rows[0]
                expect(row, serial).toEqual({ protocol, brandId: null })
            }
        })

        it("is the one the agent reached it with, its brand cleared and the change in the audit log; a failed read changes nothing", async () => {
            const agent = await agentOf("c1", "Protocol PC")
            const [{ deviceId }] = (await Devices.heartbeat(agent, beat([{ serialNumber: "PROTO-1", reachable: true }]))).devices
            const id = deviceId!
            await Devices.update(id, { brandId: await brandId("Convoy") }, "a1")

            // Not reached: a failed read says nothing of what it speaks.
            await Devices.heartbeat(agent, beat([{ serialNumber: "PROTO-1", reachable: false, error: "HIK_TIMEOUT: no answer", protocol: "HIKVISION" }]))
            expect(await device(id)).toMatchObject({ protocol: "ZKTECO", brandId: await brandId("Convoy"), reachable: false })
            expect(await protocolChanges(id)).toEqual([])

            // Reached as Hikvision's: the record was wrong.
            const reply = await Devices.heartbeat(agent, beat([{ serialNumber: "PROTO-1", reachable: true, protocol: "HIKVISION", model: "DS-K1T341AM" }]))
            expect(reply.devices).toEqual([{ serialNumber: "PROTO-1", state: "ACTIVE", deviceId: id, mode: "ANY" }])
            expect(await device(id)).toMatchObject({ protocol: "HIKVISION", brandId: null, reachable: true, model: "DS-K1T341AM", agentId: agent.id })
            expect(await protocolChanges(id)).toEqual([{
                companyId: "c1", serialNumber: "PROTO-1", name: "Terminal PROTO-1", agent: "Protocol PC",
                protocol: { from: "ZKTECO", to: "HIKVISION" }, brand: { from: "Convoy", to: null },
            }])

            // The same again changes nothing more; a Hikvision brand can be picked now.
            await Devices.heartbeat(agent, beat([{ serialNumber: "PROTO-1", reachable: true, protocol: "HIKVISION" }]))
            expect(await protocolChanges(id)).toHaveLength(1)
            await Devices.update(id, { brandId: await brandId("Hikvision") }, "a1")

            // An agent before part 7's third PR reaching it reads ZKTeco's protocol, so it is ZKTeco's, with no brand said to have been there.
            await Devices.heartbeat(agent, beat([{ serialNumber: "PROTO-1", reachable: true }]))
            expect(await device(id)).toMatchObject({ protocol: "ZKTECO", brandId: null })
            expect((await protocolChanges(id))[1]).toMatchObject({ protocol: { from: "HIKVISION", to: "ZKTECO" }, brand: { from: "Hikvision", to: null } })
        })

        it("is left alone on a terminal straight to Nizmo or retired", async () => {
            const agent = await agentOf("c1", "Left alone PC")
            const [{ deviceId }] = (await Devices.heartbeat(agent, beat([{ serialNumber: "PROTO-2", reachable: true }]))).devices
            const id = deviceId!
            await connect(id, "DIRECT")
            expect((await Devices.heartbeat(agent, beat([{ serialNumber: "PROTO-2", reachable: true, protocol: "HIKVISION" }]))).devices[0].state).toBe("DIRECT")
            await connect(id, "AGENT")
            await Devices.retire(id, "a1")
            expect((await Devices.heartbeat(agent, beat([{ serialNumber: "PROTO-2", reachable: true, protocol: "HIKVISION" }]))).devices[0].state).toBe("RETIRED")
            expect(await device(id)).toMatchObject({ protocol: "ZKTECO" })
            expect(await protocolChanges(id)).toEqual([])
        })
    })
})
