import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceIngestService as Ingest } from "@/lib/services/attendance-ingest.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import { offsetMsIn } from "@/lib/time"

/**
 * The addresses a ZKTeco terminal calls (ATTENDANCE_PLAN.md §17.3, Phase 4
 * part 6, PR 296), against a real Postgres built from the migrations:
 * whose request it is, by serial number and the office's address; what is
 * held and what is answered; what is stored; and what is kept on the
 * terminal.
 *
 * Nothing lets a ZKTeco terminal be added straight to Nizmo yet (part 6's
 * second PR), so the tests write one into the database, with its
 * addresses, and turn its company's switch on there.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, timezone, "updatedAt") VALUES ('c1', 'One', 'Africa/Cairo', now()), ('c2', 'Two', 'Asia/Kolkata', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
`

/** The office's own address, as Vercel says it. */
const OFFICE = "198.51.100.7"

describe.skipIf(!ADMIN_URL)("the addresses a ZKTeco terminal calls, in Postgres", () => {
    const dbName = `terminal_adms_test_${Date.now()}`
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
        await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = true WHERE id = 'c1'`)
        // The company's terminals start in August 2026: its first was seen then (§17.6).
        await db.query(`INSERT INTO "AttendanceDevice"(id, "companyId", "serialNumber", name, "firstSeenAt", "updatedAt") VALUES ('first', 'c1', 'FIRST-1', 'Old door', '2026-08-15T10:00:00Z', now())`)
        await Punches.mapCode("c1", { code: "7", userId: "e1" }, "a1")
    }, 180_000)

    afterAll(async () => {
        vi.restoreAllMocks()
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const device = async (id: string) => (await db.query(`SELECT * FROM "AttendanceDevice" WHERE id = $1`, [id])).rows[0]
    const punchesOf = async (deviceId: string) => (await db.query(
        `SELECT source, "sourceKey", "userId", "hardwareUserId", "rawPayload", to_char("punchAtLocal", 'YYYY-MM-DD"T"HH24:MI:SS') AS at FROM "AttendancePunch" WHERE "deviceId" = $1 ORDER BY "punchAtLocal", "hardwareUserId"`, [deviceId],
    )).rows
    const limits = async (like: string) => (await db.query(`SELECT key, count FROM "RateLimit" WHERE key LIKE $1 ORDER BY key`, [like])).rows

    /** A ZKTeco terminal straight to Nizmo with the office's address, as Add a terminal will make one. Its serial number is its id in capitals. */
    const terminal = async (id: string, extra: { companyId?: string; addresses?: string[]; protocol?: string; connection?: string; retired?: boolean; serial?: string } = {}) => {
        await db.query(
            `INSERT INTO "AttendanceDevice"(id, "companyId", "serialNumber", name, protocol, connection, "allowedAddresses", "retiredAt", "updatedAt")
             VALUES ($1, $2, $3, $1, $4::"TerminalProtocol", $5::"TerminalConnection", $6, $7, now())`,
            [id, extra.companyId ?? "c1", extra.serial ?? id.toUpperCase(), extra.protocol ?? "ZKTECO", extra.connection ?? "DIRECT", extra.addresses ?? [OFFICE], extra.retired ? new Date() : null],
        )
        return extra.serial ?? id.toUpperCase()
    }

    /** A request as the terminal makes it, from the office unless another address, or none, is given. */
    const call = async (method: "GET" | "POST", path: string, opts: { from?: string | null; body?: string; headers?: Record<string, string> } = {}) => {
        const route = await import("@/app/iclock/[...path]/route")
        const headers = { ...(opts.from === null ? {} : { "x-vercel-forwarded-for": opts.from ?? OFFICE }), ...opts.headers }
        const req = new Request(`https://nizmo.example${path}`, { method, body: opts.body, headers })
        const res = await (method === "GET" ? route.GET(req) : route.POST(req))
        return { res, req }
    }
    const status = async (method: "GET" | "POST", path: string, opts: Parameters<typeof call>[2] = {}) => (await call(method, path, opts)).res.status
    const untouched = async (id: string) => {
        expect(await punchesOf(id)).toEqual([])
        expect(await device(id)).toMatchObject({ lastSeenAt: null, lastAddress: null, refusedCount: 0, lastRefusal: null, pushCursor: null })
    }

    describe("whose request it is", () => {
        it("is nobody's without Vercel's own word for where it came from, and nothing is looked up", async () => {
            const serial = await terminal("no-header")
            const { prisma } = await import("@/lib/prisma")
            const asked = vi.spyOn(prisma.attendanceDevice, "findFirst")
            try {
                // The header a caller can set says the office: it isn't read.
                const { res } = await call("GET", `/iclock/cdata?SN=${serial}&options=all`, { from: null, headers: { "x-forwarded-for": OFFICE, "x-real-ip": OFFICE } })
                expect(res.status).toBe(403)
                expect(await res.text()).toBe("")
                expect(asked).not.toHaveBeenCalled()
            } finally {
                asked.mockRestore()
            }
            await untouched("no-header")
        })

        it("answers 403 to a serial number that is nobody's, and 429 once an address has tried 30", async () => {
            const from = "203.0.113.2"
            for (let i = 0; i < 30; i++) expect(await status("GET", `/iclock/cdata?SN=NOBODY${i}&options=all`, { from })).toBe(403)
            expect(await status("GET", "/iclock/cdata?SN=NOBODY30&options=all", { from })).toBe(429)
            expect(await limits("terminal-unknown:203.0.113.2")).toEqual([{ key: "terminal-unknown:203.0.113.2", count: 31 }])
        })

        it("counts a request with no serial number, or one that couldn't be one, the same way", async () => {
            const from = "203.0.113.3"
            expect(await status("GET", "/iclock/cdata?options=all", { from })).toBe(403)
            expect(await status("GET", "/iclock/getrequest?SN=a%20b", { from })).toBe(403)
            expect(await status("POST", `/iclock/cdata?SN=${"A".repeat(65)}&table=ATTLOG&Stamp=1`, { from, body: "7\t2026-09-14 09:05:00\t0\t1" })).toBe(403)
            expect(await limits("terminal-unknown:203.0.113.3")).toEqual([{ key: "terminal-unknown:203.0.113.3", count: 3 }])
        })

        it("says nothing to tell a known serial number called from elsewhere from an unknown one", async () => {
            const serial = await terminal("elsewhere")
            const known = (await call("GET", `/iclock/cdata?SN=${serial}&options=all`, { from: "203.0.113.9" })).res
            const unknown = (await call("GET", "/iclock/cdata?SN=NEVERHEARDOF&options=all", { from: "203.0.113.10" })).res
            expect([known.status, await known.text(), [...known.headers.keys()].sort()]).toEqual([unknown.status, await unknown.text(), [...unknown.headers.keys()].sort()])
            expect(known.status).toBe(403)
            expect(await punchesOf("elsewhere")).toEqual([])
        })

        it("notes a call from elsewhere on the terminal, with the address, once an hour at most", async () => {
            const serial = await terminal("moved")
            const scans = { from: "203.0.113.20", body: "7\t2026-09-14 09:05:00\t0\t1" }
            expect(await status("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=5`, scans)).toBe(403)
            expect(await device("moved")).toMatchObject({ refusedCount: 1, lastRefusal: "ADDRESS_NOT_ALLOWED:203.0.113.20", lastSeenAt: null, lastAddress: null, pushCursor: null })
            expect((await device("moved")).lastRefusedAt).toBeInstanceOf(Date)
            // It polls on, every few seconds: counted once.
            for (let i = 0; i < 5; i++) expect(await status("GET", `/iclock/getrequest?SN=${serial}`, { from: "203.0.113.20" })).toBe(403)
            expect(await device("moved")).toMatchObject({ refusedCount: 1, lastRefusal: "ADDRESS_NOT_ALLOWED:203.0.113.20" })
            expect(await punchesOf("moved")).toEqual([])
            // An hour on, it is noted again, with the address it comes from then.
            await db.query(`UPDATE "RateLimit" SET "resetAt" = now() - interval '1 second' WHERE key = 'terminal-elsewhere:moved'`)
            expect(await status("GET", `/iclock/getrequest?SN=${serial}`, { from: "203.0.113.21" })).toBe(403)
            expect(await device("moved")).toMatchObject({ refusedCount: 2, lastRefusal: "ADDRESS_NOT_ALLOWED:203.0.113.21" })
            // Once the office's new address is kept for it, the scans it held are taken.
            await db.query(`UPDATE "AttendanceDevice" SET "allowedAddresses" = ARRAY['203.0.113.20'] WHERE id = 'moved'`)
            expect(await status("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=5`, scans)).toBe(200)
            expect((await punchesOf("moved")).map(p => p.at)).toEqual(["2026-09-14T09:05:00"])
        })

        it("takes any of the addresses kept for it, a range among them, and none when none is kept", async () => {
            const serial = await terminal("ranges", { addresses: ["192.0.2.44", "198.51.100.64/26", "2001:db8:5::/48"] })
            const ask = (from: string) => status("GET", `/iclock/getrequest?SN=${serial}`, { from })
            expect(await ask("192.0.2.44")).toBe(200)
            expect(await ask("198.51.100.100")).toBe(200)
            expect(await ask("2001:db8:5:1::9")).toBe(200)
            expect(await ask("198.51.100.200")).toBe(403)
            expect(await ask("192.0.2.45")).toBe(403)
            // Fails closed: a terminal with no address kept is answered from nowhere.
            const bare = await terminal("no-addresses", { addresses: [] })
            expect(await status("GET", `/iclock/getrequest?SN=${bare}`)).toBe(403)
            expect(await device("no-addresses")).toMatchObject({ lastSeenAt: null })
        })

        it("is only a ZKTeco terminal added straight to Nizmo and not retired", async () => {
            const viaAgent = await terminal("via-agent", { connection: "AGENT" })
            const retired = await terminal("retired", { retired: true })
            const hikvision = await terminal("hik", { protocol: "HIKVISION" })
            for (const serial of [viaAgent, retired, hikvision]) {
                expect(await status("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=1`, { body: "7\t2026-09-14 09:05:00\t0\t1" }), serial).toBe(403)
            }
            for (const id of ["via-agent", "retired", "hik"]) {
                expect(await punchesOf(id)).toEqual([])
                // Nothing is noted on a terminal that isn't answered at all.
                expect(await device(id)).toMatchObject({ lastSeenAt: null, refusedCount: 0, lastRefusal: null })
            }
        })

        it("is the one terminal not retired that carries the serial number, found by the index that keeps it the one", async () => {
            // One a company retired, and the same terminal at another company since: only the second is answered.
            await terminal("was-ours", { serial: "MOVED-ON", retired: true })
            await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = true WHERE id = 'c2'`)
            try {
                await terminal("now-theirs", { serial: "MOVED-ON", companyId: "c2" })
                expect(await status("GET", "/iclock/getrequest?SN=MOVED-ON")).toBe(200)
                expect((await device("now-theirs")).lastSeenAt).toBeInstanceOf(Date)
                expect((await device("was-ours")).lastSeenAt).toBeNull()
                // Two that aren't retired can't carry one serial number: the database refuses the second.
                await terminal("twin-a", { serial: "TWIN" })
                await expect(terminal("twin-b", { serial: "TWIN", companyId: "c2" })).rejects.toThrow(/AttendanceDevice_serialNumber_active_key/)
            } finally {
                await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = false WHERE id = 'c2'`)
            }
            const { rows } = await db.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'AttendanceDevice' AND indexname = 'AttendanceDevice_serialNumber_active_key'`)
            expect(rows.map(r => r.indexdef)).toEqual([`CREATE UNIQUE INDEX "AttendanceDevice_serialNumber_active_key" ON public."AttendanceDevice" USING btree ("serialNumber") WHERE ("retiredAt" IS NULL)`])
            // No migration comes with this PR: the lookup needs nothing the database doesn't have.
            expect(MIGRATIONS[MIGRATIONS.length - 1]).toBe("20261231000000_terminal_first_contacts")
        })
    })

    describe("held, to be tried again", () => {
        const scans = { body: "7\t2026-09-15 09:00:00\t0\t1" }

        it("while the company's switch is off, it is suspended, or its package has no Terminals add-on", async () => {
            const serial = await terminal("held", { companyId: "c2" })
            await db.query(`UPDATE "AttendanceDevice" SET "firstSeenAt" = '2026-08-20T00:00:00Z' WHERE id = 'held'`)
            const send = () => call("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=3`, scans)
            expect((await send()).res.status).toBe(403)
            await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = true, "isBanned" = true WHERE id = 'c2'`)
            expect((await send()).res.status).toBe(403)
            await db.query(`INSERT INTO "Package"(id, name, "hasHR", "hasAttendanceMobile", "updatedAt") VALUES ('mobile-adms', 'Mobile only', true, true, now())`)
            await db.query(`UPDATE "Company" SET "isBanned" = false, "packageId" = 'mobile-adms' WHERE id = 'c2'`)
            const { res } = await send()
            expect(res.status).toBe(403)
            expect(await res.text()).toBe("")
            await untouched("held")
            // With the add-on back, the same scans sent again are taken.
            await db.query(`UPDATE "Company" SET "packageId" = NULL WHERE id = 'c2'`)
            expect((await send()).res.status).toBe(200)
            expect((await punchesOf("held")).map(p => p.at)).toEqual(["2026-09-15T09:00:00"])
            await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = false WHERE id = 'c2'`)
        })

        it("during maintenance, before anything is looked up", async () => {
            const serial = await terminal("maintenance")
            await db.query(`INSERT INTO "SystemSettings"(id, "maintenanceMode", "updatedAt") VALUES ('default', true, now()) ON CONFLICT (id) DO UPDATE SET "maintenanceMode" = true`)
            try {
                expect(await status("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=3`, scans)).toBe(503)
                expect(await status("GET", "/iclock/getrequest?SN=NOBODY")).toBe(503)
                await untouched("maintenance")
            } finally {
                await db.query(`UPDATE "SystemSettings" SET "maintenanceMode" = false`)
            }
            expect(await status("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=3`, scans)).toBe(200)
        })

        it("past 600 requests a minute from one terminal", async () => {
            const serial = await terminal("busy")
            expect(await status("GET", `/iclock/getrequest?SN=${serial}`)).toBe(200)
            await db.query(`UPDATE "RateLimit" SET count = 600 WHERE key = 'terminal:busy'`)
            expect(await status("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=3`, scans)).toBe(429)
            expect(await punchesOf("busy")).toEqual([])
            expect((await device("busy")).pushCursor).toBeNull()
        })

        it("when something fails that shouldn't: recorded by the route's pattern, and where it had got to stays", async () => {
            const serial = await terminal("failing")
            const broken = vi.spyOn(Ingest, "fromTerminal").mockRejectedValueOnce(new Error("the database went away"))
            const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
            try {
                const { res } = await call("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=3`, scans)
                expect(res.status).toBe(500)
                expect(await res.text()).toBe("")
            } finally {
                broken.mockRestore()
                quiet.mockRestore()
            }
            const { rows } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'SYSTEM_API_ERROR' ORDER BY "createdAt" DESC LIMIT 1`)
            expect(rows[0].details).toMatchObject({ route: "/iclock/[...path]", method: "POST", message: "the database went away", deviceId: "failing" })
            // Not moved on: the terminal sends the same scans again, and they are taken.
            expect((await device("failing")).pushCursor).toBeNull()
            expect(await status("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=3`, scans)).toBe(200)
            expect(await punchesOf("failing")).toHaveLength(1)
            expect((await device("failing")).pushCursor).toBe("ATTLOG=3;OPERLOG=0")
        })
    })

    describe("its first call", () => {
        it("is answered with its options, as text, and is its contact", async () => {
            const serial = await terminal("lobby")
            const { res } = await call("GET", `/iclock/cdata?SN=${serial}&options=all&pushver=2.4.1`)
            expect(res.status).toBe(200)
            expect(res.headers.get("content-type")).toContain("text/plain")
            const hours = offsetMsIn(new Date(), "Africa/Cairo") / 3_600_000
            expect((await res.text()).split("\n")).toEqual([
                "GET OPTION FROM: LOBBY", "Stamp=0", "ATTLOGStamp=0", "OpStamp=0", "OPERLOGStamp=0", "ErrorDelay=60", "Delay=30",
                "TransTimes=00:00;14:05", "TransInterval=1", "TransFlag=1000000000", "Realtime=1", "Encrypt=0", `TimeZone=${hours}`, "",
            ])
            const row = await device("lobby")
            expect(row.lastSeenAt).toBeInstanceOf(Date)
            expect(row).toMatchObject({ lastAddress: OFFICE, refusedCount: 0, pushCursor: null })
        })

        it("states no time zone for a company whose zone is off the hour", async () => {
            const serial = await terminal("kolkata", { companyId: "c2" })
            await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = true WHERE id = 'c2'`)
            try {
                const text = await (await call("GET", `/iclock/cdata?SN=${serial}&options=all`)).res.text()
                expect(text).toContain("GET OPTION FROM: KOLKATA\n")
                expect(text).not.toContain("TimeZone")
            } finally {
                await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = false WHERE id = 'c2'`)
            }
        })
    })

    describe("its scans", () => {
        it("are stored as the terminal's own, each with what it keeps of its line, and it moves on", async () => {
            const serial = await terminal("door")
            const { res } = await call("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=9999`, { body: "7\t2026-09-14 09:05:00\t0\t1\t0\t0\t0\r\n7\t2026-09-14 17:02:10\t1\t15\t2\r\n" })
            expect(res.status).toBe(200)
            expect(await res.text()).toBe("OK: 2\n")
            expect(await punchesOf("door")).toEqual([
                { source: "DEVICE_PUSH", sourceKey: "door:7:2026-09-14T09:05:00", userId: "e1", hardwareUserId: "7", at: "2026-09-14T09:05:00", rawPayload: { time: "2026-09-14 09:05:00", status: "0", verify: "1", workCode: "0" } },
                { source: "DEVICE_PUSH", sourceKey: "door:7:2026-09-14T17:02:10", userId: "e1", hardwareUserId: "7", at: "2026-09-14T17:02:10", rawPayload: { time: "2026-09-14 17:02:10", status: "1", verify: "15", workCode: "2" } },
            ])
            const row = await device("door")
            expect(row).toMatchObject({ pushCursor: "ATTLOG=9999;OPERLOG=0", lastAddress: OFFICE, refusedCount: 0 })
            // Asked again after a restart, it is told where it had got to.
            expect(await (await call("GET", `/iclock/cdata?SN=${serial}&options=all`)).res.text()).toContain("\nStamp=9999\nATTLOGStamp=9999\nOpStamp=0\n")
        })

        it("sent again are already there, and as old firmware sends them are taken too", async () => {
            const serial = await terminal("again")
            const body = "7\t2026-09-16 09:00:00\t0\t1\r\n"
            expect(await (await call("POST", `/iclock/cdata?SN=${serial}&Stamp=41`, { body })).res.text()).toBe("OK: 1\n")
            expect(await (await call("POST", `/iclock/cdata?SN=${serial}&Stamp=41`, { body })).res.text()).toBe("OK: 1\n")
            expect((await punchesOf("again")).map(p => p.at)).toEqual(["2026-09-16T09:00:00"])
            expect(await device("again")).toMatchObject({ pushCursor: "ATTLOG=41;OPERLOG=0", refusedCount: 0 })
        })

        it("count what can't be kept on the terminal, with the reason, and are answered all the same", async () => {
            const serial = await terminal("odd")
            const body = ["7\t2026-09-17 09:00:00\t0\t1", "not a line", `${"9".repeat(33)}\t2026-09-17 09:01:00\t0\t1`, "7\t2026-02-30 09:00:00\t0\t1"].join("\r\n")
            const { res } = await call("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=8`, { body })
            expect([res.status, await res.text()]).toEqual([200, "OK: 4\n"])
            expect((await punchesOf("odd")).map(p => p.at)).toEqual(["2026-09-17T09:00:00"])
            // One unreadable, one number too long, and one time no calendar has.
            const row = await device("odd")
            expect(row.refusedCount).toBe(3)
            expect(["UNREADABLE", "INVALID_NUMBER", "INVALID_TIME"]).toContain(row.lastRefusal)
            expect(row.pushCursor).toBe("ATTLOG=8;OPERLOG=0")
        })

        it("are stored a thousand at a time when a terminal sends its whole memory", async () => {
            const serial = await terminal("memory")
            const start = Date.UTC(2026, 8, 1, 0, 0, 0)
            const body = Array.from({ length: 1500 }, (_, i) => `7\t${new Date(start + i * 60_000).toISOString().slice(0, 19).replace("T", " ")}\t0\t1`).join("\r\n")
            const lots = vi.spyOn(Ingest, "fromTerminal")
            try {
                const { res } = await call("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=1500`, { body })
                expect([res.status, await res.text()]).toEqual([200, "OK: 1500\n"])
                expect(lots.mock.calls.map(c => c[1].length)).toEqual([1000, 500])
            } finally {
                lots.mockRestore()
            }
            expect(await punchesOf("memory")).toHaveLength(1500)
            expect(await device("memory")).toMatchObject({ pushCursor: "ATTLOG=1500;OPERLOG=0", refusedCount: 0 })
        }, 120_000)

        it("that fail part of the way hold where it had got to, and sent again are all there", async () => {
            const serial = await terminal("halfway")
            const start = Date.UTC(2026, 8, 3, 0, 0, 0)
            const body = Array.from({ length: 1001 }, (_, i) => `7\t${new Date(start + i * 60_000).toISOString().slice(0, 19).replace("T", " ")}\t0\t1`).join("\r\n")
            const real = Ingest.fromTerminal.bind(Ingest)
            let lot = 0
            const broken = vi.spyOn(Ingest, "fromTerminal").mockImplementation((...args) => (++lot === 2 ? Promise.reject(new Error("the second lot failed")) : real(...args)))
            const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
            try {
                expect(await status("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=1001`, { body })).toBe(500)
            } finally {
                broken.mockRestore()
                quiet.mockRestore()
            }
            expect(await punchesOf("halfway")).toHaveLength(1000)
            expect((await device("halfway")).pushCursor).toBeNull()
            expect(await (await call("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=1001`, { body })).res.text()).toBe("OK: 1001\n")
            expect(await punchesOf("halfway")).toHaveLength(1001)
            expect((await device("halfway")).pushCursor).toBe("ATTLOG=1001;OPERLOG=0")
        }, 120_000)

        it("sent while its log of changes to people is, leave each log where its own upload got it to", async () => {
            const serial = await terminal("both")
            await call("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=12`, { body: "7\t2026-09-19 09:00:00\t0\t1" })
            expect((await device("both")).pushCursor).toBe("ATTLOG=12;OPERLOG=0")
            // The scans' upload has read where the terminal had got to and is storing them when the
            // people's log arrives and is answered. Each writes its own log's stamp and leaves the
            // other's as the row holds it then, not as it was when the upload arrived (review on #296).
            const real = Ingest.fromTerminal.bind(Ingest)
            const meanwhile = vi.spyOn(Ingest, "fromTerminal").mockImplementation(async (...args) => {
                const stored = await real(...args)
                expect(await status("POST", `/iclock/cdata?SN=${serial}&table=OPERLOG&OpStamp=77`, { body: "USER PIN=7\tName=Ehab One" })).toBe(200)
                return stored
            })
            try {
                expect(await (await call("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=13`, { body: "7\t2026-09-19 17:00:00\t1\t1" })).res.text()).toBe("OK: 1\n")
            } finally {
                meanwhile.mockRestore()
            }
            expect((await device("both")).pushCursor).toBe("ATTLOG=13;OPERLOG=77")
            // And at the same moment, one of each: both are kept.
            const [scans, people] = await Promise.all([
                status("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=20`, { body: "7\t2026-09-20 09:00:00\t0\t1" }),
                status("POST", `/iclock/cdata?SN=${serial}&table=OPERLOG&OpStamp=90`, { body: "USER PIN=7\tName=Ehab One" }),
            ])
            expect([scans, people]).toEqual([200, 200])
            expect((await device("both")).pushCursor).toBe("ATTLOG=20;OPERLOG=90")
            expect((await punchesOf("both")).map(p => p.at)).toEqual(["2026-09-19T09:00:00", "2026-09-19T17:00:00", "2026-09-20T09:00:00"])
        })
    })

    describe("what is dropped unread", () => {
        it("is the log of changes to people: its body is never read, and its stamp is kept", async () => {
            const serial = await terminal("people")
            await call("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=12`, { body: "7\t2026-09-18 09:00:00\t0\t1" })
            const { res, req } = await call("POST", `/iclock/cdata?SN=${serial}&table=OPERLOG&OpStamp=77`, { body: "USER PIN=7\tName=Ehab One\tPasswd=1234\tCard=[09E4812202]\r\nFP PIN=7\tFID=1\tValid=1\tTMP=AAAA" })
            expect([res.status, await res.text()]).toEqual([200, "OK\n"])
            expect(req.bodyUsed).toBe(false)
            const row = await device("people")
            expect(row).toMatchObject({ pushCursor: "ATTLOG=12;OPERLOG=77", refusedCount: 0 })
            expect(JSON.stringify(row)).not.toContain("Ehab")
            expect(await punchesOf("people")).toHaveLength(1)
            // As old firmware sends it, with no table named.
            const old = await call("POST", `/iclock/cdata?SN=${serial}&OpStamp=78`, { body: "USER PIN=7\tName=Ehab One" })
            expect(old.req.bodyUsed).toBe(false)
            expect((await device("people")).pushCursor).toBe("ATTLOG=12;OPERLOG=78")
        })

        it("is anything else under /iclock: answered OK, and still its contact", async () => {
            const serial = await terminal("others")
            for (const [method, path, body] of [
                ["POST", `/iclock/devicecmd?SN=${serial}`, "ID=1&Return=0&CMD=INFO"],
                ["POST", `/iclock/cdata?SN=${serial}&table=ATTPHOTO&Stamp=4`, "PIN=7.jpg\nSN=x\nsize=3\nCMD=uploadphoto\0abc"],
                ["POST", `/iclock/registry?SN=${serial}`, "DeviceType=att,~DeviceName=Front"],
                ["GET", `/iclock/ping?SN=${serial}`, undefined],
                ["GET", `/iclock/cdata?SN=${serial}&type=time`, undefined],
            ] as const) {
                const { res, req } = await call(method, path, { body })
                expect([res.status, await res.text()], path).toEqual([200, "OK\n"])
                expect(req.bodyUsed, path).toBe(false)
            }
            const row = await device("others")
            expect(row.lastSeenAt).toBeInstanceOf(Date)
            expect(row).toMatchObject({ pushCursor: null, refusedCount: 0, lastAddress: OFFICE })
            expect(await punchesOf("others")).toEqual([])
        })
    })

    describe("its heartbeat", () => {
        it("is always answered OK, with no command, and keeps what it says of itself", async () => {
            const serial = await terminal("beat")
            const first = await call("GET", `/iclock/getrequest?SN=${serial}&INFO=${encodeURIComponent("Ver 6.39 Apr 28 2008,12,30,457,192.168.1.201")}`)
            expect([first.res.status, await first.res.text()]).toEqual([200, "OK\n"])
            const row = await device("beat")
            expect(row).toMatchObject({ firmware: "Ver 6.39 Apr 28 2008", userCount: 12, recordCount: 457, lastAddress: OFFICE })
            // Its address on the office network isn't kept anywhere on it.
            expect(JSON.stringify(row)).not.toContain("192.168.1.201")
            // One that says nothing of itself leaves what was kept.
            const seenAt = row.lastSeenAt as Date
            await new Promise(resolve => setTimeout(resolve, 5))
            const second = await call("GET", `/iclock/getrequest?SN=${serial}`)
            expect(await second.res.text()).toBe("OK\n")
            const later = await device("beat")
            expect(later).toMatchObject({ firmware: "Ver 6.39 Apr 28 2008", userCount: 12, recordCount: 457 })
            expect((later.lastSeenAt as Date).getTime()).toBeGreaterThan(seenAt.getTime())
        })
    })
})
