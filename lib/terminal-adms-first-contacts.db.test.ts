import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { ICLOCK_ROUTE } from "@/lib/attendance/zkteco-adms"
import { TerminalFirstContactService as Contacts } from "@/lib/services/terminal-first-contact.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"

/**
 * A ZKTeco terminal's first contacts, kept (ATTENDANCE_PLAN.md §17.8,
 * Phase 4 part 6, PR 299), against a real Postgres built from the
 * migrations: each request Nizmo takes from it, as what it is, with only
 * its scans opened; 5 of a kind; nothing of a request held or from
 * elsewhere; nothing past its first 7 days; and keeping never holds the
 * terminal. What is kept of one request is in
 * lib/attendance/zkteco-first-contact.test.ts.
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

/** The office's own internet address, as Vercel says it, and the terminal's own on the office network. */
const OFFICE = "198.51.100.7"
const ON_THE_OFFICE_NETWORK = "192.168.1.201"
const INFO = encodeURIComponent(`Ver 8.0.4.2-20230101,25,3,1532,${ON_THE_OFFICE_NETWORK},10,1,7,100`)

describe.skipIf(!ADMIN_URL)("a ZKTeco terminal's first contacts, in Postgres", () => {
    const dbName = `terminal_adms_contacts_test_${Date.now()}`
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
    const kept = async (deviceId: string) => (await db.query(`SELECT * FROM "TerminalFirstContact" WHERE "deviceId" = $1 ORDER BY "receivedAt", id`, [deviceId])).rows
    const punches = async (deviceId: string) => (await db.query(`SELECT count(*)::int AS n FROM "AttendancePunch" WHERE "deviceId" = $1`, [deviceId])).rows[0].n

    /** A ZKTeco terminal straight to Nizmo with the office's address, as Add a terminal makes one. Its serial number is its id in capitals. */
    const terminal = async (id: string, companyId = "c1") => {
        await db.query(
            `INSERT INTO "AttendanceDevice"(id, "companyId", "serialNumber", name, protocol, connection, "allowedAddresses", "updatedAt")
             VALUES ($1, $2, $3, $1, 'ZKTECO', 'DIRECT', $4, now())`,
            [id, companyId, id.toUpperCase(), [OFFICE]],
        )
        return id.toUpperCase()
    }

    /** A request as the terminal makes it, from the office unless another address is given. */
    const call = async (method: "GET" | "POST", path: string, opts: { from?: string; body?: string } = {}) => {
        const route = await import("@/app/iclock/[...path]/route")
        const headers: Record<string, string> = { "x-vercel-forwarded-for": opts.from ?? OFFICE, "user-agent": "iClock Proxy/1.09" }
        if (opts.body !== undefined) Object.assign(headers, { "content-type": "text/plain", "content-length": String(Buffer.byteLength(opts.body)) })
        const req = new Request(`https://nizmo.example${path}`, { method, body: opts.body, headers })
        return method === "GET" ? route.GET(req) : route.POST(req)
    }
    const options = (serial: string) => call("GET", `/iclock/cdata?SN=${serial}&options=all&pushver=2.4.1&language=69`)
    const heartbeat = (serial: string) => call("GET", `/iclock/getrequest?SN=${serial}&INFO=${INFO}`)
    const scans = (serial: string, body: string, stamp = 1) => call("POST", `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=${stamp}`, { body })
    const people = (serial: string) => call("POST", `/iclock/cdata?SN=${serial}&table=OPERLOG&OpStamp=3`, { body: "USER PIN=7\tName=Ehab Hassan\tPri=0\tPasswd=1234\tCard=[0012345678]\tGrp=1\n" })

    describe("a request Nizmo takes", () => {
        it("is kept as what it is: its first call, its heartbeat, its scans, and changes to its people never opened", async () => {
            const serial = await terminal("keeps")
            expect((await device("keeps")).firstContactAt).toBeNull()
            const before = Date.now()
            expect((await options(serial)).status).toBe(200)
            expect((await heartbeat(serial)).status).toBe(200)
            expect((await scans(serial, "7\t2026-11-16 08:01:02\t0\t1\t0\t0\t1234567890\n")).status).toBe(200)
            expect((await people(serial)).status).toBe(200)

            const rows = await kept("keeps")
            expect(rows.map(r => [r.method, r.kind, r.outcome])).toEqual([
                ["GET", "options", ["OPTIONS"]],
                ["GET", "getrequest", ["NOTHING"]],
                ["POST", "ATTLOG", ["STORED"]],
                ["POST", "OPERLOG", ["NOT_OPENED"]],
            ])
            const [first, beat, scan, changes] = rows
            expect(first).toMatchObject({ path: `/iclock/cdata?SN=${serial}&options=all&pushver=2.4.1&language=69`, body: "" })
            expect(first.headers).toEqual({ "user-agent": "iClock Proxy/1.09" })
            expect(first.otherHeaders).toContain("x-vercel-forwarded-for")
            expect(beat.path).toBe(`/iclock/getrequest?SN=${serial}&INFO=Ver 8.0.4.2-20230101,25,3,1532,[address removed],10,1,7,100`)
            expect(scan).toMatchObject({ path: `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=1`, body: "7\t2026-11-16 08:01:02\t0\t1\t0\t0\t[removed, 10 characters]" })
            expect(scan.headers).toMatchObject({ "content-type": "text/plain" })
            expect(changes.body).toBe("[not opened: changes to the people it holds carry their names]")
            // Neither the office's address, nor the terminal's on the office network, nor anything about a person.
            const all = JSON.stringify(rows)
            for (const never of [OFFICE, ON_THE_OFFICE_NETWORK, "Ehab", "Hassan", "1234567890", "0012345678", "Passwd"]) expect(all, never).not.toContain(never)

            // Its 7 days run from its first, which was taken as ever.
            const at = (await device("keeps")).firstContactAt as Date
            expect(at.getTime()).toBeGreaterThanOrEqual(before - 1000)
            expect(at.getTime()).toBe((first.receivedAt as Date).getTime())
            expect(await punches("keeps")).toBe(1)
            // Read back for the Super Admin in the order it came.
            const list = await Contacts.list("keeps")
            expect(list?.keeping).toBe(true)
            expect(list?.contacts.map(c => c.kind)).toEqual(["options", "getrequest", "ATTLOG", "OPERLOG"])
        })

        it("keeps 5 of a kind, and counts a heartbeat past them without keeping it, so they don't crowd out its scans", async () => {
            const serial = await terminal("beats")
            for (let i = 0; i < 5; i++) expect((await heartbeat(serial)).status).toBe(200)
            const keep = vi.spyOn(Contacts, "keep")
            try {
                for (let i = 0; i < 3; i++) expect((await heartbeat(serial)).status).toBe(200)
                expect(keep).not.toHaveBeenCalled()
            } finally {
                keep.mockRestore()
            }
            expect((await scans(serial, "7\t2026-11-16 09:00:00\t0\t1\n")).status).toBe(200)
            expect((await kept("beats")).map(r => r.kind)).toEqual(["getrequest", "getrequest", "getrequest", "getrequest", "getrequest", "ATTLOG"])
        })

        it("keeps the line of a scan refused, and what it can't read as a scan without names or long numbers", async () => {
            const serial = await terminal("odd")
            expect((await scans(serial, "PIN=7\tName=Ehab Hassan\tCard=12345678\n8\t2026-11-16 09:00:00\t0\t1\nUSER 1234567890\n")).status).toBe(200)
            const [row] = await kept("odd")
            expect(row.body).toBe("PIN=7\tName=[name removed]\n8\t2026-11-16 09:00:00\t0\t1\nUSER [number removed]")
            // Nobody has the number 8: its scan is kept unmatched, and the two lines it couldn't read are refused.
            expect(row.outcome).toEqual(["STORED", "REFUSED:UNREADABLE"])
        })
    })

    describe("what isn't kept", () => {
        it("nothing of a call from elsewhere, nor of one held to be sent again", async () => {
            const serial = await terminal("away")
            expect((await call("GET", `/iclock/cdata?SN=${serial}&options=all`, { from: "203.0.113.40" })).status).toBe(403)
            expect(await kept("away")).toEqual([])
            expect((await device("away")).firstContactAt).toBeNull()

            // Its company's switch is off: held with 403.
            const held = await terminal("held", "c2")
            for (let i = 0; i < 3; i++) expect((await options(held)).status).toBe(403)
            expect(await kept("held")).toEqual([])
            expect((await device("held")).firstContactAt).toBeNull()

            // Past its limit, held with 429.
            const busy = await terminal("busy")
            expect((await options(busy)).status).toBe(200)
            await db.query(`UPDATE "RateLimit" SET count = 600 WHERE key = 'terminal:busy'`)
            expect((await scans(busy, "7\t2026-11-16 10:00:00\t0\t1\n")).status).toBe(429)
            expect((await kept("busy")).map(r => r.kind)).toEqual(["options"])
        })

        it("nothing once its first 7 days are over, and nothing is looked up for it", async () => {
            const serial = await terminal("later")
            expect((await options(serial)).status).toBe(200)
            await db.query(`UPDATE "AttendanceDevice" SET "firstContactAt" = now() - interval '7 days 1 minute' WHERE id = 'later'`)
            const counts = vi.spyOn(Contacts, "counts")
            try {
                expect((await scans(serial, "7\t2026-11-16 11:00:00\t0\t1\n")).status).toBe(200)
                expect(counts).not.toHaveBeenCalled()
            } finally {
                counts.mockRestore()
            }
            expect((await kept("later")).map(r => r.kind)).toEqual(["options"])
            expect(await punches("later")).toBe(1)
        })

        it("nothing past 50, with no kind full", async () => {
            const serial = await terminal("fifty")
            await db.query(`INSERT INTO "TerminalFirstContact"(id, "deviceId", method, path, headers, body, kind) SELECT 'f-' || n, 'fifty', 'GET', '/x', '{}', '', 'kind' || (n % 12) FROM generate_series(1, 50) AS n`)
            await db.query(`UPDATE "AttendanceDevice" SET "firstContactAt" = now() WHERE id = 'fifty'`)
            expect((await options(serial)).status).toBe(200)
            expect(await kept("fifty")).toHaveLength(50)
        })
    })

    describe("keeping", () => {
        it("never holds a terminal when what is kept can't be counted: its scans are taken, and the failure recorded", async () => {
            const serial = await terminal("uncounted")
            const broken = vi.spyOn(Contacts, "counts").mockRejectedValueOnce(new Error("the contacts table can't be read"))
            const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
            try {
                const res = await scans(serial, "7\t2026-11-16 12:00:00\t0\t1\n", 5)
                expect([res.status, await res.text()]).toEqual([200, "OK: 1\n"])
            } finally {
                broken.mockRestore()
                quiet.mockRestore()
            }
            expect(await punches("uncounted")).toBe(1)
            expect((await device("uncounted")).pushCursor).toBe("ATTLOG=5;OPERLOG=0")
            expect(await kept("uncounted")).toEqual([])
            const { rows } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'SYSTEM_API_ERROR' ORDER BY "createdAt" DESC LIMIT 1`)
            expect(rows[0].details).toMatchObject({ route: ICLOCK_ROUTE, method: "POST", message: "the contacts table can't be read", deviceId: "uncounted", step: "first contact" })
            // Its next request is kept as ever.
            expect((await heartbeat(serial)).status).toBe(200)
            expect((await kept("uncounted")).map(r => r.kind)).toEqual(["getrequest"])
        })

        it("never holds a terminal when what is kept of a request can't be worked out: its scans are taken, and the failure recorded", async () => {
            const serial = await terminal("unworked")
            const rules = await import("@/lib/attendance/zkteco-first-contact")
            const broken = vi.spyOn(rules, "admsContact").mockImplementationOnce(() => { throw new Error("a line that breaks the rules") })
            const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
            try {
                const res = await scans(serial, "7\t2026-11-16 13:00:00\t0\t1\n", 6)
                expect([res.status, await res.text()]).toEqual([200, "OK: 1\n"])
            } finally {
                broken.mockRestore()
                quiet.mockRestore()
            }
            expect(await punches("unworked")).toBe(1)
            expect(await kept("unworked")).toEqual([])
            const { rows } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'SYSTEM_API_ERROR' ORDER BY "createdAt" DESC LIMIT 1`)
            expect(rows[0].details).toMatchObject({ route: ICLOCK_ROUTE, method: "POST", message: "a line that breaks the rules", deviceId: "unworked", step: "first contact" })
        })

        it("never holds a terminal when keeping fails: its options are answered, and the failure recorded", async () => {
            const serial = await terminal("failing")
            const broken = vi.spyOn(Contacts, "keep").mockRejectedValueOnce(new Error("the contacts table went away"))
            const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
            try {
                const res = await options(serial)
                expect(res.status).toBe(200)
                expect(await res.text()).toContain(`GET OPTION FROM: ${serial}\n`)
            } finally {
                broken.mockRestore()
                quiet.mockRestore()
            }
            expect(await kept("failing")).toEqual([])
            const { rows } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'SYSTEM_API_ERROR' ORDER BY "createdAt" DESC LIMIT 1`)
            expect(rows[0].details).toMatchObject({ route: ICLOCK_ROUTE, method: "GET", message: "the contacts table went away", deviceId: "failing", step: "first contact" })
        })
    })
})
