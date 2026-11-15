import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { hashSecret } from "@/lib/attendance/agent-credentials"
import { newPushSecret } from "@/lib/attendance/terminal-secrets"
import { AttendanceIngestService as Ingest } from "@/lib/services/attendance-ingest.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import { AttendanceDeviceService as Devices } from "@/lib/services/attendance-device.service"
import { offsetMsIn } from "@/lib/time"

/**
 * The address a Hikvision terminal sends to (ATTENDANCE_PLAN.md §17.2,
 * Phase 4 part 5, PR 291), against a real Postgres built from the
 * migrations: whose request it is, what is held and what is answered, what
 * is stored, and what is counted on the terminal.
 *
 * Nothing gives a terminal its secret or turns a company's switch on yet,
 * so the tests set both in the database.
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

/** An access event as a terminal sends it. */
const access = (employee: string, at: string, minor = 75) => ({
    ipAddress: "192.0.2.10", macAddress: "00:00:5e:00:53:01", dateTime: `${at}+03:00`, eventType: "AccessControllerEvent", eventState: "active",
    AccessControllerEvent: { deviceName: "Lobby", majorEventType: 5, subEventType: minor, name: "Somebody", employeeNoString: employee, serialNo: 1, picturesNumber: 1 },
})

describe.skipIf(!ADMIN_URL)("the address a Hikvision terminal sends to, in Postgres", () => {
    const dbName = `terminal_push_test_${Date.now()}`
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
        `SELECT source, "sourceKey", "userId", "hardwareUserId", to_char("punchAtLocal", 'YYYY-MM-DD"T"HH24:MI:SS') AS at FROM "AttendancePunch" WHERE "deviceId" = $1 ORDER BY "punchAtLocal", "hardwareUserId"`, [deviceId],
    )).rows
    /** A Hikvision terminal straight to Nizmo with its secret, as Add a terminal will make one. */
    const terminal = async (id: string, companyId = "c1", extra: { protocol?: string; connection?: string } = {}) => {
        const secret = newPushSecret()
        await db.query(
            `INSERT INTO "AttendanceDevice"(id, "companyId", "serialNumber", name, protocol, connection, "pushSecretHash", "updatedAt") VALUES ($1, $2, $1, $1, $3::"TerminalProtocol", $4::"TerminalConnection", $5, now())`,
            [id, companyId, extra.protocol ?? "HIKVISION", extra.connection ?? "DIRECT", hashSecret(secret)],
        )
        return secret
    }
    let address = 0
    /** A request as the terminal makes it, from an address of its own unless one is given. */
    const send = async (secret: string, body?: BodyInit | null, headers: Record<string, string> = {}) => {
        const { POST } = await import("@/app/api/terminals/hikvision/[secret]/route")
        const from = headers["x-forwarded-for"] ?? `198.51.100.${++address}`
        const req = new Request(`https://nizmo.example/api/terminals/hikvision/${secret}`, { method: "POST", body, headers: { "x-forwarded-for": from, ...headers } })
        return POST(req, { params: Promise.resolve({ secret }) })
    }
    const json = (event: unknown) => [JSON.stringify(event), { "Content-Type": "application/json" }] as const
    const limits = async (like: string) => (await db.query(`SELECT key, count FROM "RateLimit" WHERE key LIKE $1 ORDER BY key`, [like])).rows

    describe("whose request it is", () => {
        it("answers 404 to what isn't a secret's shape, without asking the database", async () => {
            const { prisma } = await import("@/lib/prisma")
            const asked = vi.spyOn(prisma.attendanceDevice, "findUnique")
            try {
                for (const not of ["x", "a".repeat(42), "../admin", "mka_" + "a".repeat(43)]) {
                    const res = await send(not, JSON.stringify(access("7", "2026-09-14T09:05:00")), { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.1" })
                    expect(res.status, not).toBe(404)
                    expect(await res.text()).toBe("")
                }
                expect(asked).not.toHaveBeenCalled()
                expect(await limits("terminal%203.0.113.1%")).toEqual([])
            } finally {
                asked.mockRestore()
            }
        })

        it("answers 404 to a secret that is nobody's, and 429 once an address has tried 30", async () => {
            const from = { "x-forwarded-for": "203.0.113.2" }
            for (let i = 0; i < 30; i++) expect((await send(newPushSecret(), null, from)).status).toBe(404)
            expect((await send(newPushSecret(), null, from)).status).toBe(429)
            expect(await limits("terminal-unknown:203.0.113.2")).toEqual([{ key: "terminal-unknown:203.0.113.2", count: 31 }])
            // The terminals behind that address still get through with their own secret.
            const secret = await terminal("behind-nat")
            expect((await send(secret, null, from)).status).toBe(200)
        })

        it("is the terminal the secret belongs to, by its hash alone", async () => {
            const secret = await terminal("lobby")
            const row = await device("lobby")
            expect(JSON.stringify(row)).not.toContain(secret)
            expect(row.pushSecretHash).toBe(hashSecret(secret))
            // A secret is for a Hikvision terminal's address: one on another protocol's terminal opens nothing.
            const other = await terminal("zk", "c1", { protocol: "ZKTECO" })
            expect((await send(other, ...json(access("7", "2026-09-14T09:05:00")))).status).toBe(404)
            expect(await punchesOf("zk")).toEqual([])
        })
    })

    describe("held, to be sent again", () => {
        const event = json(access("7", "2026-09-15T09:00:00"))
        const untouched = async (id: string) => {
            expect(await punchesOf(id)).toEqual([])
            expect(await device(id)).toMatchObject({ lastSeenAt: null, lastAddress: null, refusedCount: 0, lastRefusal: null })
        }

        it("while the company's switch is off, it is suspended, or its package has no Terminals add-on", async () => {
            const secret = await terminal("held", "c2")
            // Its company's first terminal, seen in August: where that company's terminals start (§17.6).
            await db.query(`UPDATE "AttendanceDevice" SET "firstSeenAt" = '2026-08-20T00:00:00Z' WHERE id = 'held'`)
            expect((await send(secret, ...event)).status).toBe(403)
            await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = true, "isBanned" = true WHERE id = 'c2'`)
            expect((await send(secret, ...event)).status).toBe(403)
            await db.query(`INSERT INTO "Package"(id, name, "hasHR", "hasAttendanceMobile", "updatedAt") VALUES ('mobile', 'Mobile only', true, true, now())`)
            await db.query(`UPDATE "Company" SET "isBanned" = false, "packageId" = 'mobile' WHERE id = 'c2'`)
            const res = await send(secret, ...event)
            expect(res.status).toBe(403)
            expect(await res.text()).toBe("")
            await untouched("held")
            // With the add-on back, the same event sent again is taken.
            await db.query(`UPDATE "Company" SET "packageId" = NULL WHERE id = 'c2'`)
            expect((await send(secret, ...event)).status).toBe(200)
            expect((await punchesOf("held")).map(p => p.at)).toEqual(["2026-09-15T09:00:00"])
        })

        it("during maintenance, before anything is looked up", async () => {
            const secret = await terminal("maintenance")
            await db.query(`INSERT INTO "SystemSettings"(id, "maintenanceMode", "updatedAt") VALUES ('default', true, now()) ON CONFLICT (id) DO UPDATE SET "maintenanceMode" = true`)
            try {
                expect((await send(secret, ...event)).status).toBe(503)
                expect((await send("x", ...event)).status).toBe(503)
                await untouched("maintenance")
            } finally {
                await db.query(`UPDATE "SystemSettings" SET "maintenanceMode" = false`)
            }
            expect((await send(secret, ...event)).status).toBe(200)
        })

        it("past 600 requests a minute from one terminal", async () => {
            const secret = await terminal("busy")
            expect((await send(secret, ...event)).status).toBe(200)
            await db.query(`UPDATE "RateLimit" SET count = 600 WHERE key = 'terminal:busy'`)
            expect((await send(secret, ...json(access("7", "2026-09-15T17:00:00")))).status).toBe(429)
            expect((await punchesOf("busy")).map(p => p.at)).toEqual(["2026-09-15T09:00:00"])
        })

        it("when something fails that shouldn't, recorded without the secret", async () => {
            const secret = await terminal("failing")
            const broken = vi.spyOn(Ingest, "fromTerminal").mockRejectedValueOnce(new Error("the database went away"))
            const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
            try {
                const res = await send(secret, ...event)
                expect(res.status).toBe(500)
                expect(await res.text()).toBe("")
                expect(JSON.stringify(quiet.mock.calls)).not.toContain(secret)
            } finally {
                broken.mockRestore()
                quiet.mockRestore()
            }
            const { rows } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'SYSTEM_API_ERROR' ORDER BY "createdAt" DESC LIMIT 1`)
            expect(rows[0].details).toMatchObject({ route: "/api/terminals/hikvision/[secret]", method: "POST", message: "the database went away", deviceId: "failing" })
            expect(JSON.stringify(rows[0].details)).not.toContain(secret)
            // Sent again, it is taken.
            expect((await send(secret, ...event)).status).toBe(200)
            expect(await punchesOf("failing")).toHaveLength(1)
        })
    })

    describe("answered with an empty 200", () => {
        it("stores a scan from each of the three shapes, as the terminal's own, and notes the contact", async () => {
            const secret = await terminal("shapes")
            const form = new FormData()
            form.set("event_log", JSON.stringify(access("7", "2026-09-14T09:05:00")))
            form.set("Picture", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "Picture.jpg", { type: "image/jpeg" }))
            const first = await send(secret, form, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" })
            expect(first.status).toBe(200)
            expect(await first.text()).toBe("")

            expect((await send(secret, ...json(access("99", "2026-09-14T13:00:00", 0x26)))).status).toBe(200)
            const xml = `<EventNotificationAlert><dateTime>2026-09-14T17:02:00+03:00</dateTime><eventType>AccessControllerEvent</eventType><AccessControllerEvent><majorEventType>5</majorEventType><subEventType>1</subEventType><employeeNoString>7</employeeNoString></AccessControllerEvent></EventNotificationAlert>`
            expect((await send(secret, xml, { "Content-Type": "application/xml", "x-forwarded-for": "203.0.113.8" })).status).toBe(200)

            expect(await punchesOf("shapes")).toEqual([
                { source: "DEVICE_PUSH", sourceKey: "shapes:7:2026-09-14T09:05:00", userId: "e1", hardwareUserId: "7", at: "2026-09-14T09:05:00" },
                { source: "DEVICE_PUSH", sourceKey: "shapes:99:2026-09-14T13:00:00", userId: null, hardwareUserId: "99", at: "2026-09-14T13:00:00" },
                { source: "DEVICE_PUSH", sourceKey: "shapes:7:2026-09-14T17:02:00", userId: "e1", hardwareUserId: "7", at: "2026-09-14T17:02:00" },
            ])
            const row = await device("shapes")
            expect(row).toMatchObject({ lastAddress: "203.0.113.8", refusedCount: 0, lastRefusal: null })
            expect(Date.now() - (row.lastSeenAt as Date).getTime()).toBeLessThan(60_000)
            expect(row.lastPunchAt).toEqual(new Date("2026-09-14T14:02:00Z"))
            // Nothing of the event but the scan is kept: no name, no picture.
            const { rows } = await db.query(`SELECT * FROM "AttendancePunch" WHERE "deviceId" = 'shapes'`)
            expect(JSON.stringify(rows)).not.toContain("Somebody")
        })

        it("stores a scan sent again once, as a terminal that never heard back sends it", async () => {
            const secret = await terminal("again")
            for (let i = 0; i < 3; i++) expect((await send(secret, ...json(access("7", "2026-09-16T09:00:00")))).status).toBe(200)
            expect(await punchesOf("again")).toHaveLength(1)
            expect((await device("again")).refusedCount).toBe(0)
        })

        it("takes a request with nothing to keep as a contact: a heartbeat, a door, a failed check, the terminal's own test", async () => {
            const secret = await terminal("quiet")
            const nothing: (readonly [BodyInit | null, Record<string, string>])[] = [
                json({ eventType: "heartBeat", dateTime: "2026-09-16T09:00:00+03:00", eventState: "active" }),
                json(access("", "2026-09-16T09:00:01", 0x4c)),   // a face that matched nobody
                json(access("7", "2026-09-16T09:00:02", 0x29)),  // 7's card with another's finger
                json(access("", "2026-09-16T09:00:03", 0x15)),   // the door opened
                [null, {}],                                      // the terminal's test of its setting
            ]
            for (const [body, headers] of nothing) expect((await send(secret, body, headers)).status).toBe(200)
            expect(await punchesOf("quiet")).toEqual([])
            const row = await device("quiet")
            expect(row).toMatchObject({ refusedCount: 0, lastRefusal: null })
            expect(row.lastSeenAt).toBeInstanceOf(Date)
        })

        it("counts on the terminal what it can't keep, with the reason, and still answers", async () => {
            const secret = await terminal("counted")
            const counted = async (reason: string, n: number) => expect(await device("counted")).toMatchObject({ refusedCount: n, lastRefusal: reason })
            // A passed check of a type Nizmo doesn't know: it must show in the trial, not vanish (§17.8).
            expect((await send(secret, ...json(access("7", "2026-09-17T09:00:00", 113)))).status).toBe(200)
            await counted("EVENT_NOT_KNOWN:113", 1)
            expect((await send(secret, ...json(access("9".repeat(33), "2026-09-17T09:00:00")))).status).toBe(200)
            await counted("INVALID_NUMBER", 2)
            expect((await send(secret, "hello", { "Content-Type": "text/plain" })).status).toBe(200)
            await counted("UNREADABLE", 3)
            // What the ingest refuses is counted the same way: a time no calendar has, and one far ahead.
            expect((await send(secret, ...json(access("7", "2026-02-30T09:00:00")))).status).toBe(200)
            await counted("INVALID_TIME", 4)
            expect((await send(secret, ...json(access("7", "2099-01-01T09:00:00")))).status).toBe(200)
            await counted("IN_FUTURE", 5)
            // And a scan from before the company's terminals started is skipped, not counted.
            expect((await send(secret, ...json(access("7", "2024-03-10T09:00:00")))).status).toBe(200)
            await counted("IN_FUTURE", 5)
            expect(await punchesOf("counted")).toEqual([])
            expect((await device("counted")).lastRefusedAt).toBeInstanceOf(Date)
        })

        it("refuses, counts and answers a terminal set to the agent, and one that is retired", async () => {
            const viaAgent = await terminal("via-agent", "c1", { connection: "AGENT" })
            expect((await send(viaAgent, ...json(access("7", "2026-09-18T09:00:00")))).status).toBe(200)
            expect(await device("via-agent")).toMatchObject({ refusedCount: 1, lastRefusal: "DEVICE_VIA_AGENT" })
            const retired = await terminal("retired")
            await db.query(`UPDATE "AttendanceDevice" SET "retiredAt" = now() WHERE id = 'retired'`)
            expect((await send(retired, ...json(access("7", "2026-09-18T09:00:00")))).status).toBe(200)
            expect(await device("retired")).toMatchObject({ refusedCount: 1, lastRefusal: "DEVICE_RETIRED" })
            expect([...(await punchesOf("via-agent")), ...(await punchesOf("retired"))]).toEqual([])
        })
    })

    describe("what a scan keeps of its event (PR 293)", () => {
        const keptOf = async (deviceId: string) => (await db.query(`SELECT "hardwareUserId", "rawPayload" FROM "AttendancePunch" WHERE "deviceId" = $1 ORDER BY "punchAtLocal"`, [deviceId])).rows
        /** The same event at another offset from UTC, or with none stated. */
        const stating = (employee: string, at: string, zone: string) => ({ ...access(employee, at), dateTime: `${at}${zone}` })

        it("keeps the fields Nizmo knows on its punch, and never a name, a card's number or a picture", async () => {
            const secret = await terminal("keeps")
            const event = access("7", "2026-09-21T09:05:00")
            const whole = {
                ...event, PicInfo: [{ url: "http://192.0.2.10/pic/1.jpg" }], somethingNew: "who knows",
                AccessControllerEvent: {
                    ...event.AccessControllerEvent, cardNo: "1234567890", currentVerifyMode: "cardOrFaceOrFp", cardReaderNo: 1, doorNo: 1, mask: "no",
                    pictureURL: "http://192.0.2.10/pic/1.jpg", FaceRect: { height: 0.2, width: 0.1, x: 0.4, y: 0.5 },
                },
            }
            const form = new FormData()
            form.set("event_log", JSON.stringify(whole))
            form.set("Picture", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "Picture.jpg", { type: "image/jpeg" }))
            expect((await send(secret, form)).status).toBe(200)
            // The older XML keeps the same fields, by their names.
            const xml = `<EventNotificationAlert><ipAddress>192.0.2.10</ipAddress><dateTime>2026-09-21T17:02:00+03:00</dateTime><eventType>AccessControllerEvent</eventType><AccessControllerEvent><deviceName>Lobby</deviceName><majorEventType>5</majorEventType><subEventType>1</subEventType><employeeNoString>7</employeeNoString><name>Somebody</name><cardNo>1234567890</cardNo></AccessControllerEvent></EventNotificationAlert>`
            expect((await send(secret, xml, { "Content-Type": "application/xml" })).status).toBe(200)

            const rows = await keptOf("keeps")
            expect(rows).toEqual([
                { hardwareUserId: "7", rawPayload: {
                    dateTime: "2026-09-21T09:05:00+03:00", eventType: "AccessControllerEvent", eventState: "active", ipAddress: "192.0.2.10", macAddress: "00:00:5e:00:53:01",
                    AccessControllerEvent: { deviceName: "Lobby", majorEventType: 5, subEventType: 75, employeeNoString: "7", serialNo: 1, currentVerifyMode: "cardOrFaceOrFp", cardReaderNo: 1, doorNo: 1, picturesNumber: 1 },
                } },
                { hardwareUserId: "7", rawPayload: {
                    dateTime: "2026-09-21T17:02:00+03:00", eventType: "AccessControllerEvent", ipAddress: "192.0.2.10",
                    AccessControllerEvent: { deviceName: "Lobby", majorEventType: "5", subEventType: "1", employeeNoString: "7" },
                } },
            ])
            const { rows: punches } = await db.query(`SELECT * FROM "AttendancePunch" WHERE "deviceId" = 'keeps'`)
            const text = JSON.stringify(punches)
            for (const never of ["Somebody", '"name"', "cardNo", "1234567890", "pictureURL", ".jpg", "FaceRect", "PicInfo", "mask", "somethingNew", "who knows"]) expect(text, never).not.toContain(never)
        })

        it("keeps it on a new punch only: a scan sent again stays as it was first kept", async () => {
            const secret = await terminal("kept-once")
            const first = access("7", "2026-09-22T09:00:00")
            expect((await send(secret, ...json(first))).status).toBe(200)
            const again = { ...first, AccessControllerEvent: { ...first.AccessControllerEvent, serialNo: 2, deviceName: "Renamed" } }
            expect((await send(secret, ...json(again))).status).toBe(200)
            const rows = await keptOf("kept-once")
            expect(rows).toHaveLength(1)
            expect(rows[0].rawPayload.AccessControllerEvent).toMatchObject({ serialNo: 1, deviceName: "Lobby" })
        })

        it("keeps the terminal's own offset from UTC as its last scan stated it, and never moves a scan by it", async () => {
            const secret = await terminal("zone")
            expect((await device("zone")).utcOffsetMinutes).toBeNull()
            // A contact with no scan says nothing of its zone.
            expect((await send(secret, ...json({ eventType: "heartBeat", dateTime: "2026-09-23T08:00:00+08:00", eventState: "active" }))).status).toBe(200)
            expect((await device("zone")).utcOffsetMinutes).toBeNull()

            expect((await send(secret, ...json(stating("7", "2026-09-23T09:00:00", "+08:00")))).status).toBe(200)
            expect((await device("zone")).utcOffsetMinutes).toBe(480)
            // One with none stated doesn't empty it; the next that states one replaces it.
            expect((await send(secret, ...json(stating("7", "2026-09-23T13:00:00", "")))).status).toBe(200)
            expect((await device("zone")).utcOffsetMinutes).toBe(480)
            expect((await send(secret, ...json([stating("7", "2026-09-23T17:00:00", "-05:00"), stating("7", "2026-09-23T17:30:00", "+05:30")]))).status).toBe(200)
            expect((await device("zone")).utcOffsetMinutes).toBe(330)
            expect((await send(secret, ...json(stating("7", "2026-09-23T18:00:00", "Z")))).status).toBe(200)
            expect((await device("zone")).utcOffsetMinutes).toBe(0)

            // Whatever it stated, each scan is at the terminal's wall clock, with its dateTime kept whole.
            expect((await punchesOf("zone")).map(p => p.at)).toEqual(["2026-09-23T09:00:00", "2026-09-23T13:00:00", "2026-09-23T17:00:00", "2026-09-23T17:30:00", "2026-09-23T18:00:00"])
            expect((await keptOf("zone")).map(r => r.rawPayload.dateTime)).toEqual(["2026-09-23T09:00:00+08:00", "2026-09-23T13:00:00", "2026-09-23T17:00:00-05:00", "2026-09-23T17:30:00+05:30", "2026-09-23T18:00:00Z"])
        })

        it("notes no offset on a terminal set to the agent, or one that is retired", async () => {
            const viaAgent = await terminal("zone-agent", "c1", { connection: "AGENT" })
            const retired = await terminal("zone-retired")
            await db.query(`UPDATE "AttendanceDevice" SET "retiredAt" = now() WHERE id = 'zone-retired'`)
            for (const secret of [viaAgent, retired]) expect((await send(secret, ...json(stating("7", "2026-09-24T09:00:00", "+08:00")))).status).toBe(200)
            expect((await device("zone-agent")).utcOffsetMinutes).toBeNull()
            expect((await device("zone-retired")).utcOffsetMinutes).toBeNull()
        })

        it("says on the terminals list when a terminal's time zone isn't the company's now", async () => {
            // The company's own offset now, summer time or not.
            const company = Math.round(offsetMsIn(new Date(), "Africa/Cairo") / 60_000)
            const two = (n: number) => String(n).padStart(2, "0")
            const zone = (minutes: number) => `${minutes < 0 ? "-" : "+"}${two(Math.floor(Math.abs(minutes) / 60))}:${two(Math.abs(minutes) % 60)}`
            const same = await terminal("zone-same")
            const other = await terminal("zone-other")
            const unstated = await terminal("zone-unstated")
            expect((await send(same, ...json(stating("7", "2026-09-25T09:00:00", zone(company))))).status).toBe(200)
            expect((await send(other, ...json(stating("7", "2026-09-25T09:01:00", "+08:00")))).status).toBe(200)
            expect((await send(unstated, ...json(stating("7", "2026-09-25T09:02:00", "")))).status).toBe(200)

            const listed = new Map((await Devices.list("c1")).map(d => [d.id, d]))
            expect(listed.get("zone-same")).toMatchObject({ utcOffsetMinutes: company, health: { state: "OK", zoneOff: false } })
            expect(listed.get("zone-other")).toMatchObject({ utcOffsetMinutes: 480, health: { state: "OK", zoneOff: true } })
            expect(listed.get("zone-unstated")).toMatchObject({ utcOffsetMinutes: null, health: { state: "OK", zoneOff: false } })
            // One the agent reads states none, and is never flagged.
            expect(listed.get("first")).toMatchObject({ utcOffsetMinutes: null, health: { zoneOff: false } })
            // What a punch keeps is never on the list.
            expect(JSON.stringify([...listed.values()])).not.toContain("rawPayload")
        })
    })
})
