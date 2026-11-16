import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { MAX_IP_RANGES } from "@/lib/attendance/ip-ranges"
import { AttendanceDeviceService as Devices } from "@/lib/services/attendance-device.service"

/**
 * A ZKTeco terminal added straight to Nizmo, and the office's internet
 * address it is let in from (ATTENDANCE_PLAN.md §17.3, §17.7, Phase 4
 * part 6, PR 297), against a real Postgres built from the migrations: what
 * is added, what is refused, the address changed later, and that the
 * addresses a ZKTeco terminal calls (PR 296) answer it from there alone.
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
const ELSEWHERE = "198.51.100.9"

describe.skipIf(!ADMIN_URL)("a ZKTeco terminal straight to Nizmo and its office's address, in Postgres", () => {
    const dbName = `terminal_office_test_${Date.now()}`
    let db: Client
    let zk = "", hik = ""

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
        zk = brand("ZKTeco"); hik = brand("Hikvision")
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

    /** A ZKTeco terminal's first call, as it makes it, from this address. */
    const firstCall = async (serial: string, from: string) => {
        const { GET } = await import("@/app/iclock/[...path]/route")
        const res = await GET(new Request(`https://nizmo.example/iclock/cdata?SN=${serial}&options=all`, { headers: { "x-vercel-forwarded-for": from } }))
        return { status: res.status, text: await res.text() }
    }

    describe("added straight to Nizmo", () => {
        it("keeps the office's address, as written back, each once, with nothing issued and nothing secret", async () => {
            const added = await Devices.add("c1", {
                name: "Front door", serialNumber: "ZK-100", brandId: zk, mode: "ENTRANCE", connection: "DIRECT",
                officeAddresses: [` ${OFFICE} `, "198.51.100.0/28", OFFICE, "::ffff:192.0.2.4"],
            }, "a1")
            const id = added.device.id
            // Nothing to show once: what to set on it holds no secret.
            expect(added.path).toBeNull()
            expect(added.device).toMatchObject({ name: "Front door", protocol: "ZKTECO", connection: "DIRECT", allowedAddresses: [OFFICE, "198.51.100.0/28", "192.0.2.4"] })
            expect(await row(id)).toMatchObject({
                connection: "DIRECT", protocol: "ZKTECO", pushSecretHash: null, allowedAddresses: [OFFICE, "198.51.100.0/28", "192.0.2.4"],
                addedById: "a1", lastSeenAt: null, agentId: null,
            })
            // Its row says where it's let in from, and that it waits for its first contact.
            const shown = await listed("c1", id)
            expect(shown).toMatchObject({ allowedAddresses: [OFFICE, "198.51.100.0/28", "192.0.2.4"], health: { state: "WAITING" } })
            expect(await audit(id)).toEqual([{
                action: "ADD_ATTENDANCE_DEVICE", userId: "a1",
                details: { companyId: "c1", serialNumber: "ZK-100", name: "Front door", brand: "ZKTeco", mode: "ENTRANCE", connection: "DIRECT", officeAddresses: `${OFFICE}, 198.51.100.0/28, 192.0.2.4` },
            }])
        })

        it("is answered from the office's address, and from nowhere else", async () => {
            await Devices.add("c1", { name: "Back door", serialNumber: "ZK-101", brandId: zk, connection: "DIRECT", officeAddresses: [OFFICE] }, "a1")
            const answered = await firstCall("ZK-101", OFFICE)
            expect(answered.status).toBe(200)
            expect(answered.text.startsWith("GET OPTION FROM: ZK-101\n")).toBe(true)
            expect(await firstCall("ZK-101", ELSEWHERE)).toEqual({ status: 403, text: "" })
            // A range lets in every address in it.
            await Devices.add("c1", { name: "Side door", serialNumber: "ZK-102", brandId: zk, connection: "DIRECT", officeAddresses: ["198.51.100.0/28"] }, "a1")
            expect((await firstCall("ZK-102", "198.51.100.14")).status).toBe(200)
            expect((await firstCall("ZK-102", "198.51.100.16")).status).toBe(403)
        })
    })

    describe("what is refused", () => {
        it("is a ZKTeco terminal straight to Nizmo with no office's address, or one that isn't an address or a range", async () => {
            const before = await count()
            const add = (officeAddresses?: string[]) => Devices.add("c1", { name: "Gate", serialNumber: "ZK-200", brandId: zk, connection: "DIRECT", officeAddresses }, "a1")
            await expect(add()).rejects.toThrow("DEVICE_OFFICE_ADDRESS_REQUIRED")
            await expect(add([])).rejects.toThrow("DEVICE_OFFICE_ADDRESS_REQUIRED")
            await expect(add(["  ", ""])).rejects.toThrow("DEVICE_OFFICE_ADDRESS_REQUIRED")
            await expect(add([OFFICE, "the office"])).rejects.toThrow("DEVICE_INVALID_OFFICE_ADDRESS")
            await expect(add(["203.0.113.0/33"])).rejects.toThrow("DEVICE_INVALID_OFFICE_ADDRESS")
            await expect(add(Array.from({ length: MAX_IP_RANGES + 1 }, (_, i) => `203.0.113.${i + 1}`))).rejects.toThrow("DEVICE_TOO_MANY_OFFICE_ADDRESSES")
            expect(await count()).toBe(before)
        })

        it("is an office's address for any other terminal: Hikvision's has its own address, and one through the agent is read at the office", async () => {
            const before = await count()
            await expect(Devices.add("c1", { name: "Lobby", serialNumber: "HK-200", brandId: hik, connection: "DIRECT", officeAddresses: [OFFICE] }, "a1")).rejects.toThrow("DEVICE_NO_OFFICE_ADDRESS")
            await expect(Devices.add("c1", { name: "Gate", serialNumber: "ZK-201", brandId: zk, connection: "AGENT", officeAddresses: [OFFICE] }, "a1")).rejects.toThrow("DEVICE_NO_OFFICE_ADDRESS")
            expect(await count()).toBe(before)
            // With none given, both are added as before.
            const hk = await Devices.add("c1", { name: "Lobby", serialNumber: "HK-200", brandId: hik, connection: "DIRECT" }, "a1")
            expect(hk.path).toMatch(/^\/api\/terminals\/hikvision\//)
            expect((await row(hk.device.id)).allowedAddresses).toEqual([])
            const agent = await Devices.add("c1", { name: "Gate", serialNumber: "ZK-201", brandId: zk, connection: "AGENT", officeAddresses: [] }, "a1")
            expect(agent.path).toBeNull()
            expect((await row(agent.device.id)).allowedAddresses).toEqual([])
        })

        it("is straight to Nizmo where the Super Admin hasn't turned it on, before its address is looked at", async () => {
            await expect(Devices.add("c2", { name: "Gate", serialNumber: "ZK-202", brandId: zk, connection: "DIRECT", officeAddresses: [OFFICE] }, "a2")).rejects.toThrow("DEVICE_DIRECT_NOT_ALLOWED")
            await expect(Devices.add("c2", { name: "Gate", serialNumber: "ZK-202", brandId: zk, connection: "DIRECT" }, "a2")).rejects.toThrow("DEVICE_DIRECT_NOT_ALLOWED")
        })
    })

    describe("the office's address changed", () => {
        it("lets the terminal in from the new address alone, as written back, and is in the audit log with before and after", async () => {
            const { device } = await Devices.add("c1", { name: "Store", serialNumber: "ZK-300", brandId: zk, connection: "DIRECT", officeAddresses: [OFFICE] }, "a1")
            expect((await firstCall("ZK-300", OFFICE)).status).toBe(200)
            const changed = await Devices.setOfficeAddresses(device.id, [` ${ELSEWHERE} `, "2001:DB8::/32", ELSEWHERE], "a1")
            expect(changed).toMatchObject({ id: device.id, allowedAddresses: [ELSEWHERE, "2001:DB8::/32"] })
            expect((await row(device.id)).allowedAddresses).toEqual([ELSEWHERE, "2001:DB8::/32"])
            expect((await firstCall("ZK-300", ELSEWHERE)).status).toBe(200)
            expect((await firstCall("ZK-300", OFFICE)).status).toBe(403)
            expect((await audit(device.id)).at(-1)).toEqual({
                action: "UPDATE_ATTENDANCE_DEVICE", userId: "a1",
                details: { companyId: "c1", serialNumber: "ZK-300", name: "Store", officeAddresses: { from: OFFICE, to: `${ELSEWHERE}, 2001:DB8::/32` } },
            })
        })

        it("changes nothing, and records nothing, when it's the same addresses", async () => {
            const { device } = await Devices.add("c1", { name: "Annex", serialNumber: "ZK-301", brandId: zk, connection: "DIRECT", officeAddresses: [OFFICE] }, "a1")
            const before = (await audit(device.id)).length
            await Devices.setOfficeAddresses(device.id, [` ${OFFICE}`], "a1")
            expect((await audit(device.id)).length).toBe(before)
        })

        it("works whether the company's switch is on or off: it only moves where the terminal is let in from", async () => {
            const { device } = await Devices.add("c1", { name: "Yard", serialNumber: "ZK-302", brandId: zk, connection: "DIRECT", officeAddresses: [OFFICE] }, "a1")
            await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = false WHERE id = 'c1'`)
            try {
                await Devices.setOfficeAddresses(device.id, [ELSEWHERE], "a1")
                expect((await row(device.id)).allowedAddresses).toEqual([ELSEWHERE])
            } finally {
                await db.query(`UPDATE "Company" SET "terminalsDirectAllowed" = true WHERE id = 'c1'`)
            }
        })

        it("is refused for no address, one that isn't one, too many, another kind of terminal, a retired one, and one that isn't there", async () => {
            const { device } = await Devices.add("c1", { name: "Loading bay", serialNumber: "ZK-303", brandId: zk, connection: "DIRECT", officeAddresses: [OFFICE] }, "a1")
            await expect(Devices.setOfficeAddresses(device.id, [" "], "a1")).rejects.toThrow("DEVICE_OFFICE_ADDRESS_REQUIRED")
            await expect(Devices.setOfficeAddresses(device.id, ["office"], "a1")).rejects.toThrow("DEVICE_INVALID_OFFICE_ADDRESS")
            await expect(Devices.setOfficeAddresses(device.id, Array.from({ length: MAX_IP_RANGES + 1 }, (_, i) => `203.0.113.${i + 1}`), "a1")).rejects.toThrow("DEVICE_TOO_MANY_OFFICE_ADDRESSES")
            expect((await row(device.id)).allowedAddresses).toEqual([OFFICE])
            const hk = await Devices.add("c1", { name: "Hall", serialNumber: "HK-300", brandId: hik, connection: "DIRECT" }, "a1")
            await expect(Devices.setOfficeAddresses(hk.device.id, [OFFICE], "a1")).rejects.toThrow("DEVICE_NO_OFFICE_ADDRESS")
            const agent = await Devices.add("c1", { name: "Hall gate", serialNumber: "ZK-304", brandId: zk, connection: "AGENT" }, "a1")
            await expect(Devices.setOfficeAddresses(agent.device.id, [OFFICE], "a1")).rejects.toThrow("DEVICE_NO_OFFICE_ADDRESS")
            await Devices.retire(device.id, "a1")
            await expect(Devices.setOfficeAddresses(device.id, [ELSEWHERE], "a1")).rejects.toThrow("DEVICE_RETIRED")
            expect((await row(device.id)).allowedAddresses).toEqual([OFFICE])
            await expect(Devices.setOfficeAddresses("nope", [OFFICE], "a1")).rejects.toThrow("DEVICE_NOT_FOUND")
        })
    })
})
