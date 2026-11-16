import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { hashSecret } from "@/lib/attendance/agent-credentials"
import { HIKVISION_ROUTE, newPushSecret } from "@/lib/attendance/terminal-secrets"
import { TerminalFirstContactService as Contacts } from "@/lib/services/terminal-first-contact.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"

/**
 * A terminal's first contacts, kept (ATTENDANCE_PLAN.md §17.8, Phase 4
 * part 5, PR 294), against a real Postgres built from the migrations: what
 * is kept of a request Nizmo takes, how many and for how long, that
 * keeping never holds a terminal, and that the nightly job clears them.
 * What is kept of one request's headers and body is in
 * lib/attendance/terminal-first-contact.test.ts.
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

/** An access event as a terminal sends it, with what must not be kept in it. */
const access = (employee: string, at: string, minor = 75) => ({
    ipAddress: "192.0.2.10", macAddress: "00:00:5e:00:53:01", dateTime: `${at}+02:00`, eventType: "AccessControllerEvent", eventState: "active",
    AccessControllerEvent: { deviceName: "Lobby", majorEventType: 5, subEventType: minor, name: "Somebody Nobody", cardNo: "1234567890", employeeNoString: employee, serialNo: 1, picturesNumber: 1 },
})
const heartbeat = { eventType: "heartBeat", dateTime: "2026-09-16T09:00:00+02:00", eventState: "active" }

describe.skipIf(!ADMIN_URL)("a terminal's first contacts, in Postgres", () => {
    const dbName = `terminal_contacts_test_${Date.now()}`
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
    /** A Hikvision terminal straight to Nizmo with its secret, as Add a terminal makes one. */
    const terminal = async (id: string, companyId = "c1", extra: { connection?: string } = {}) => {
        const secret = newPushSecret()
        await db.query(
            `INSERT INTO "AttendanceDevice"(id, "companyId", "serialNumber", name, protocol, connection, "pushSecretHash", "updatedAt") VALUES ($1, $2, $1, $1, 'HIKVISION', $3::"TerminalConnection", $4, now())`,
            [id, companyId, extra.connection ?? "DIRECT", hashSecret(secret)],
        )
        return secret
    }
    let address = 0
    const send = async (secret: string, body?: BodyInit | null, headers: Record<string, string> = {}) => {
        const { POST } = await import("@/app/api/terminals/hikvision/[secret]/route")
        const req = new Request(`https://nizmo.example/api/terminals/hikvision/${secret}`, { method: "POST", body, headers: { "x-forwarded-for": `198.51.100.${(++address % 250) + 1}`, ...headers } })
        return POST(req, { params: Promise.resolve({ secret }) })
    }
    const json = (event: unknown) => [JSON.stringify(event), { "Content-Type": "application/json", "User-Agent": "Hikvision-Webs" }] as const

    describe("a request Nizmo takes", () => {
        it("is kept with its headers, its body without names, card numbers or pictures, its kind, and what Nizmo made of it", async () => {
            const secret = await terminal("keeps")
            expect((await device("keeps")).firstContactAt).toBeNull()
            const form = new FormData()
            form.set("event_log", JSON.stringify(access("7", "2026-09-14T09:05:00")))
            form.set("Picture", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "Somebody.jpg", { type: "image/jpeg" }))
            const before = Date.now()
            expect((await send(secret, form, { "User-Agent": "Hikvision-Webs", Authorization: "Digest username=\"admin\", response=\"6629fae4\"", "X-Vercel-Oidc-Token": "eyJhbGciOiJSUzI1NiJ9.x.y" })).status).toBe(200)

            const [row, ...more] = await kept("keeps")
            expect(more).toEqual([])
            expect(row).toMatchObject({ method: "POST", path: HIKVISION_ROUTE, kind: "AccessControllerEvent 5/75", outcome: ["STORED"] })
            expect(row.headers).toMatchObject({ "user-agent": "Hikvision-Webs", authorization: "Digest [removed]" })
            expect(row.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/)
            expect(row.otherHeaders).toEqual(["x-forwarded-for", "x-vercel-oidc-token"])
            expect(row.body).toContain('part "event_log": text, ')
            expect(row.body).toContain('"employeeNoString": "7"')
            expect(row.body).toContain('"name": "[name removed]"')
            expect(row.body).toContain('"cardNo": "[card number removed]"')
            expect(row.body).toContain('part "Picture": a file (image/jpeg, .jpg, 7 bytes), not opened')
            expect((row.receivedAt as Date).getTime()).toBeGreaterThanOrEqual(before - 1000)
            // Nothing of the secret, the person, the card, the credential or the host's own token is anywhere on it.
            const text = JSON.stringify(row)
            for (const never of [secret, "Somebody", "Nobody", "1234567890", "6629fae4", "eyJhbGci", "198.51.100."]) expect(text, never).not.toContain(never)
            // Its first request is marked on the terminal, once: its 7 days run from then.
            const first = (await device("keeps")).firstContactAt as Date
            expect(first.getTime()).toBe((row.receivedAt as Date).getTime())
            expect((await send(secret, ...json(heartbeat))).status).toBe(200)
            expect(((await device("keeps")).firstContactAt as Date).getTime()).toBe(first.getTime())
            // And the scan itself was stored as before.
            expect((await db.query(`SELECT count(*)::int AS n FROM "AttendancePunch" WHERE "deviceId" = 'keeps'`)).rows[0].n).toBe(1)
        })

        it("says what Nizmo made of each: the terminal's test, a heartbeat, a scan there already, one refused, a body it couldn't read", async () => {
            const secret = await terminal("outcomes")
            expect((await send(secret, null)).status).toBe(200)
            expect((await send(secret, ...json(heartbeat))).status).toBe(200)
            expect((await send(secret, ...json(access("7", "2026-09-15T09:00:00")))).status).toBe(200)
            expect((await send(secret, ...json(access("7", "2026-09-15T09:00:00")))).status).toBe(200)
            expect((await send(secret, ...json(access("7", "2099-01-01T09:00:00")))).status).toBe(200)
            expect((await send(secret, ...json(access("7", "2024-03-10T09:00:00")))).status).toBe(200)
            expect((await send(secret, ...json(access("7", "2026-09-15T09:10:00", 113)))).status).toBe(200)
            expect((await send(secret, "hello", { "Content-Type": "text/plain" })).status).toBe(200)
            expect((await kept("outcomes")).map(r => [r.kind, r.outcome, r.body.length > 0])).toEqual([
                ["empty", ["EMPTY"], false],
                ["heartBeat", ["NOTHING"], true],
                ["AccessControllerEvent 5/75", ["STORED"], true],
                ["AccessControllerEvent 5/75", ["ALREADY"], true],
                ["AccessControllerEvent 5/75", ["REFUSED:IN_FUTURE"], true],
                // From before the company's terminals started: answered, never stored.
                ["AccessControllerEvent 5/75", ["SKIPPED"], true],
                ["AccessControllerEvent 5/113", ["REFUSED:EVENT_NOT_KNOWN:113"], true],
                ["unreadable", ["UNREADABLE"], true],
            ])
        })

        it("is read back in the order it came, with until when more are kept", async () => {
            const read = (await Contacts.list("outcomes"))!
            expect(read.name).toBe("outcomes")
            expect(read.contacts.map(c => c.kind)).toEqual(["empty", "heartBeat", "AccessControllerEvent 5/75", "AccessControllerEvent 5/75", "AccessControllerEvent 5/75", "AccessControllerEvent 5/75", "AccessControllerEvent 5/113", "unreadable"])
            expect(read.keptUntil!.getTime() - read.firstContactAt!.getTime()).toBe(7 * 86_400_000)
            // Whether more are kept is said by the server's clock: yes now, no once its 7 days are over.
            expect(read.keeping).toBe(true)
            expect((await Contacts.list("outcomes", new Date(read.keptUntil!.getTime() + 1)))!.keeping).toBe(false)
            expect(Object.keys(read.contacts[0]).sort()).toEqual(["body", "headers", "id", "kind", "method", "otherHeaders", "outcome", "path", "receivedAt"])
            // A terminal with nothing kept yet, and one nobody has.
            await terminal("silent")
            expect(await Contacts.list("silent")).toEqual({ name: "silent", firstContactAt: null, keptUntil: null, keeping: true, contacts: [] })
            expect(await Contacts.list("nobody")).toBeNull()
        })
    })

    describe("how many, and for how long", () => {
        it("keeps 5 of a kind, so a terminal's heartbeats don't crowd out its scans", async () => {
            const secret = await terminal("beats")
            for (let i = 0; i < 8; i++) expect((await send(secret, ...json(heartbeat))).status).toBe(200)
            expect((await send(secret, ...json(access("7", "2026-09-16T09:00:00")))).status).toBe(200)
            for (let i = 0; i < 3; i++) expect((await send(secret, ...json(heartbeat))).status).toBe(200)
            expect((await kept("beats")).map(r => r.kind)).toEqual(["heartBeat", "heartBeat", "heartBeat", "heartBeat", "heartBeat", "AccessControllerEvent 5/75"])
        })

        it("keeps no more of a kind when requests come at once, and marks the terminal's first once", async () => {
            const secret = await terminal("at-once")
            // Twelve together: each finds nothing kept when it arrives, and only five may be.
            const answers = await Promise.all(Array.from({ length: 12 }, () => send(secret, ...json(heartbeat))))
            expect(answers.map(res => res.status)).toEqual(Array.from({ length: 12 }, () => 200))
            const rows = await kept("at-once")
            expect(rows.map(r => r.kind)).toEqual(["heartBeat", "heartBeat", "heartBeat", "heartBeat", "heartBeat"])
            // Its 7 days run from the first that was kept.
            expect(((await device("at-once")).firstContactAt as Date).getTime()).toBe((rows[0].receivedAt as Date).getTime())
        })

        it("dates none kept before the terminal's first, whichever of those at once is let in first (PR 295)", async () => {
            // Dated as each arrived, one let in later could be dated a moment before the first: about one run in six.
            for (let n = 0; n < 10; n++) {
                const id = `in-order-${n}`
                const secret = await terminal(id)
                await Promise.all(Array.from({ length: 12 }, () => send(secret, ...json(heartbeat))))
                const rows = await kept(id)
                expect(rows).toHaveLength(5)
                const first = ((await device(id)).firstContactAt as Date).getTime()
                expect(rows.map(r => (r.receivedAt as Date).getTime() >= first), id).toEqual([true, true, true, true, true])
                expect((rows[0].receivedAt as Date).getTime(), id).toBe(first)
            }
            // The clock is read once the terminal's row is held.
            const service = readFileSync("lib/services/terminal-first-contact.service.ts", "utf8")
            expect(service.indexOf("const now = at ?? new Date()")).toBeGreaterThan(service.indexOf("FOR NO KEY UPDATE`"))
            expect(service).toContain("static async keep(deviceId: string, contact: KeptContact, at?: Date): Promise<boolean> {")
        })

        it("keeps no more than 50 when the last ones come at once", async () => {
            const secret = await terminal("last-ones")
            await db.query(`INSERT INTO "TerminalFirstContact"(id, "deviceId", method, path, headers, body, kind) SELECT 'lo-' || n, 'last-ones', 'POST', '/x', '{}', '', 'kind' || (n % 12) FROM generate_series(1, 48) AS n`)
            await db.query(`UPDATE "AttendanceDevice" SET "firstContactAt" = now() WHERE id = 'last-ones'`)
            await Promise.all(Array.from({ length: 6 }, (_, i) => send(secret, ...json({ eventType: `late${i}`, dateTime: "2026-09-16T09:00:00+02:00" }))))
            expect(await kept("last-ones")).toHaveLength(50)
        })

        it("keeps 50 in all, and then takes no copy of a request at all", async () => {
            const secret = await terminal("fifty")
            // Eleven kinds, five of each: the last five find no room.
            for (let kind = 0; kind < 11; kind++) {
                for (let i = 0; i < 5; i++) expect((await send(secret, ...json({ eventType: `kind${kind}`, dateTime: "2026-09-16T09:00:00+02:00" }))).status).toBe(200)
            }
            const rows = await kept("fifty")
            expect(rows).toHaveLength(50)
            expect(new Set(rows.map(r => r.kind)).size).toBe(10)
            const keep = vi.spyOn(Contacts, "keep")
            try {
                expect((await send(secret, ...json({ eventType: "another" }))).status).toBe(200)
                expect(keep).not.toHaveBeenCalled()
            } finally {
                keep.mockRestore()
            }
            expect(await kept("fifty")).toHaveLength(50)
        })

        it("keeps nothing once the terminal's first 7 days are over, and looks nothing up for it", async () => {
            const secret = await terminal("later")
            expect((await send(secret, ...json(heartbeat))).status).toBe(200)
            expect(await kept("later")).toHaveLength(1)
            await db.query(`UPDATE "AttendanceDevice" SET "firstContactAt" = now() - interval '7 days 1 minute' WHERE id = 'later'`)
            const counts = vi.spyOn(Contacts, "counts")
            try {
                expect((await send(secret, ...json(access("7", "2026-09-17T09:00:00")))).status).toBe(200)
                expect(counts).not.toHaveBeenCalled()
            } finally {
                counts.mockRestore()
            }
            expect(await kept("later")).toHaveLength(1)
            // The scan is taken as ever.
            expect((await db.query(`SELECT count(*)::int AS n FROM "AttendancePunch" WHERE "deviceId" = 'later'`)).rows[0].n).toBe(1)
        })

        it("keeps nothing of a request that is held, to be sent again", async () => {
            const secret = await terminal("held", "c2")
            // Its company's switch is off: held with 403, and sent again until it is taken.
            for (let i = 0; i < 3; i++) expect((await send(secret, ...json(heartbeat))).status).toBe(403)
            expect(await kept("held")).toEqual([])
            expect((await device("held")).firstContactAt).toBeNull()
            // Past its limit, held with 429.
            const busy = await terminal("busy")
            expect((await send(busy, ...json(heartbeat))).status).toBe(200)
            await db.query(`UPDATE "RateLimit" SET count = 600 WHERE key = 'terminal:busy'`)
            expect((await send(busy, ...json(access("7", "2026-09-17T10:00:00")))).status).toBe(429)
            expect((await kept("busy")).map(r => r.kind)).toEqual(["heartBeat"])
        })

        it("keeps nothing for a terminal set to the agent, or one that is retired", async () => {
            const viaAgent = await terminal("via-agent", "c1", { connection: "AGENT" })
            const retired = await terminal("retired")
            await db.query(`UPDATE "AttendanceDevice" SET "retiredAt" = now() WHERE id = 'retired'`)
            for (const secret of [viaAgent, retired]) expect((await send(secret, ...json(access("7", "2026-09-18T09:00:00")))).status).toBe(200)
            expect([...(await kept("via-agent")), ...(await kept("retired"))]).toEqual([])
            expect((await device("via-agent")).firstContactAt).toBeNull()
            expect((await device("retired")).firstContactAt).toBeNull()
        })
    })

    describe("keeping", () => {
        it("never holds a terminal when what is kept can't even be counted: its scan is stored, and the failure recorded (review on PR 294)", async () => {
            const secret = await terminal("uncounted")
            const broken = vi.spyOn(Contacts, "counts").mockRejectedValueOnce(new Error("the contacts table can't be read"))
            const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
            try {
                expect((await send(secret, ...json(access("7", "2026-09-20T09:00:00")))).status).toBe(200)
                expect(JSON.stringify(quiet.mock.calls)).not.toContain(secret)
            } finally {
                broken.mockRestore()
                quiet.mockRestore()
            }
            expect((await db.query(`SELECT count(*)::int AS n FROM "AttendancePunch" WHERE "deviceId" = 'uncounted'`)).rows[0].n).toBe(1)
            expect(await kept("uncounted")).toEqual([])
            const { rows } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'SYSTEM_API_ERROR' ORDER BY "createdAt" DESC LIMIT 1`)
            expect(rows[0].details).toMatchObject({ route: HIKVISION_ROUTE, method: "POST", message: "the contacts table can't be read", deviceId: "uncounted", step: "first contact" })
            expect(JSON.stringify(rows[0].details)).not.toContain(secret)
            // Its next request is kept as ever.
            expect((await send(secret, ...json(heartbeat))).status).toBe(200)
            expect((await kept("uncounted")).map(r => r.kind)).toEqual(["heartBeat"])
        })

        it("never holds a terminal: the request is answered and its scan stored, and the failure recorded without the secret", async () => {
            const secret = await terminal("failing")
            const broken = vi.spyOn(Contacts, "keep").mockRejectedValueOnce(new Error("the contacts table went away"))
            const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
            try {
                const res = await send(secret, ...json(access("7", "2026-09-19T09:00:00")))
                expect(res.status).toBe(200)
                expect(JSON.stringify(quiet.mock.calls)).not.toContain(secret)
            } finally {
                broken.mockRestore()
                quiet.mockRestore()
            }
            expect((await db.query(`SELECT count(*)::int AS n FROM "AttendancePunch" WHERE "deviceId" = 'failing'`)).rows[0].n).toBe(1)
            const { rows } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'SYSTEM_API_ERROR' ORDER BY "createdAt" DESC LIMIT 1`)
            expect(rows[0].details).toMatchObject({ route: HIKVISION_ROUTE, method: "POST", message: "the contacts table went away", deviceId: "failing", step: "first contact" })
            expect(JSON.stringify(rows[0].details)).not.toContain(secret)
        })

        it("is cleared by the nightly job 7 days after each came, and goes with its terminal", async () => {
            await terminal("old")
            await db.query(`INSERT INTO "TerminalFirstContact"(id, "deviceId", "receivedAt", method, path, headers, body, kind) VALUES
                ('old-1', 'old', now() - interval '7 days 1 minute', 'POST', '/x', '{}', '', 'empty'),
                ('old-2', 'old', now() - interval '6 days 23 hours', 'POST', '/x', '{}', '', 'empty'),
                ('old-3', 'old', now(), 'POST', '/x', '{}', '', 'empty')`)
            const before = (await db.query(`SELECT count(*)::int AS n FROM "TerminalFirstContact"`)).rows[0].n
            expect(await Contacts.prune()).toBe(1)
            expect((await kept("old")).map(r => r.id)).toEqual(["old-2", "old-3"])
            expect((await db.query(`SELECT count(*)::int AS n FROM "TerminalFirstContact"`)).rows[0].n).toBe(before - 1)
            await db.query(`DELETE FROM "AttendanceDevice" WHERE id = 'old'`)
            expect(await kept("old")).toEqual([])
        })
    })
})
