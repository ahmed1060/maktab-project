import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { TerminalBrandService as Brands } from "@/lib/services/terminal-brand.service"

/**
 * Terminal brands (ATTENDANCE_PLAN.md §17.9, Phase 4 part 3, PR 279): the
 * Super Admin's list of what is printed on a terminal, each with the
 * protocol its terminals speak. Against a real Postgres built from the
 * migrations, since what's refused rests on the rows a terminal holds.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

describe.skipIf(!ADMIN_URL)("terminal brands, in Postgres", () => {
    const dbName = `terminal_brands_test_${Date.now()}`
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
        // A terminal already there before the brands, as in production.
        for (const m of MIGRATIONS) {
            if (m.endsWith("_terminal_brands")) {
                await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now())`)
                await db.query(`INSERT INTO "AttendanceDevice"(id, "companyId", "serialNumber", name, "updatedAt") VALUES ('old', 'c1', 'OLD-1', 'Front door', now())`)
            }
            await db.query(sql(m))
        }
        await db.query(`INSERT INTO "SuperAdmin"(id, email, username, password, "firstName", "lastName", "updatedAt") VALUES ('sa1', 'sa@x', 'sa1', 'p', 'Sara', 'Admin', now())`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const refusal = (code: string) => expect.objectContaining({ message: code })
    const idOf = async (name: string) => (await db.query(`SELECT id FROM "TerminalBrand" WHERE name = $1`, [name])).rows[0].id as string
    const audits = async (action: string) => (await db.query(`SELECT "entityId", details, "superAdminId" FROM "AuditLog" WHERE action = $1 ORDER BY "createdAt"`, [action])).rows
    let serial = 0
    /** A terminal printed with this brand, as part 3's second PR will let an Admin pick. */
    const terminalWith = async (brandId: string) => {
        serial += 1
        await db.query(`INSERT INTO "AttendanceDevice"(id, "companyId", "serialNumber", name, "brandId", "updatedAt") VALUES ($1, 'c1', $1, 'Gate', $2, now())`, [`t${serial}`, brandId])
    }

    describe("the migration", () => {
        it("starts the list with ZKTeco, Hikvision and Convoy, Convoy speaking ZKTeco's protocol", async () => {
            const { rows } = await db.query(`SELECT name, protocol, "retiredAt", "notesEn", "notesAr" FROM "TerminalBrand" ORDER BY name`)
            expect(rows).toEqual([
                { name: "Convoy", protocol: "ZKTECO", retiredAt: null, notesEn: null, notesAr: null },
                { name: "Hikvision", protocol: "HIKVISION", retiredAt: null, notesEn: null, notesAr: null },
                { name: "ZKTeco", protocol: "ZKTECO", retiredAt: null, notesEn: null, notesAr: null },
            ])
        })

        it("gives a terminal already there ZKTeco's protocol, the one the agent reads it with, and no brand", async () => {
            const { rows } = await db.query(`SELECT protocol, "brandId" FROM "AttendanceDevice" WHERE id = 'old'`)
            expect(rows).toEqual([{ protocol: "ZKTECO", brandId: null }])
        })

        it("refuses a second brand of the same name, capitals aside", async () => {
            await expect(db.query(`INSERT INTO "TerminalBrand"(id, name, protocol, "updatedAt") VALUES ('x', 'zkteco', 'ZKTECO', now())`)).rejects.toThrow()
        })
    })

    describe("the list", () => {
        it("gives each brand its protocol, notes and how many terminals have it, the retired last", async () => {
            const convoy = await idOf("Convoy")
            await terminalWith(convoy)
            await terminalWith(convoy)
            const list = await Brands.list()
            expect(list.map(b => [b.name, b.protocol, b.terminalCount, b.retiredAt])).toEqual([
                ["Convoy", "ZKTECO", 2, null],
                ["Hikvision", "HIKVISION", 0, null],
                ["ZKTeco", "ZKTECO", 0, null],
            ])
        })
    })

    describe("adding a brand", () => {
        it("takes its name and a protocol Nizmo speaks, with notes in either language, and writes it to the audit log", async () => {
            const added = await Brands.create({ name: "  Anviz  ", protocol: "ZKTECO", notesEn: " Settings under Comm. ", notesAr: "" }, "sa1")
            expect(added).toMatchObject({ name: "Anviz", protocol: "ZKTECO", notesEn: "Settings under Comm.", notesAr: null, retiredAt: null, terminalCount: 0 })
            expect(await audits("CREATE_TERMINAL_BRAND")).toEqual([{ entityId: added.id, details: { name: "Anviz", protocol: "ZKTECO" }, superAdminId: "sa1" }])
        })

        it("refuses one without a name, one whose name is taken, capitals aside, and a protocol Nizmo doesn't speak", async () => {
            await expect(Brands.create({ name: "  ", protocol: "ZKTECO" }, "sa1")).rejects.toEqual(refusal("BRAND_NAME_REQUIRED"))
            await expect(Brands.create({ name: "hikvision", protocol: "HIKVISION" }, "sa1")).rejects.toEqual(refusal("BRAND_NAME_TAKEN"))
            await expect(Brands.create({ name: "Suprema", protocol: "BIOSTAR" as never }, "sa1")).rejects.toEqual(refusal("BRAND_PROTOCOL_UNKNOWN"))
        })
    })

    describe("changing a brand", () => {
        it("changes its name and notes at any time, and its protocol while no terminal has it", async () => {
            const anviz = await idOf("Anviz")
            const changed = await Brands.update(anviz, { name: "Anviz C2", protocol: "HIKVISION", notesEn: null, notesAr: "الإعدادات في قائمة الاتصال" }, "sa1")
            expect(changed).toMatchObject({ name: "Anviz C2", protocol: "HIKVISION", notesEn: null, notesAr: "الإعدادات في قائمة الاتصال" })
            const [entry] = await audits("UPDATE_TERMINAL_BRAND")
            expect(entry.details).toEqual({
                name: "Anviz C2",
                changes: { name: { from: "Anviz", to: "Anviz C2" }, protocol: { from: "ZKTECO", to: "HIKVISION" }, notesEn: { from: "Settings under Comm.", to: null }, notesAr: { from: null, to: "الإعدادات في قائمة الاتصال" } },
            })
        })

        it("keeps the protocol of one a terminal has, since changing it would cut the terminal off", async () => {
            const convoy = await idOf("Convoy")
            await expect(Brands.update(convoy, { name: "Convoy", protocol: "HIKVISION" }, "sa1")).rejects.toEqual(refusal("BRAND_PROTOCOL_IN_USE"))
            // Its name and notes still change.
            expect(await Brands.update(convoy, { name: "Convoy", protocol: "ZKTECO", notesEn: "Speaks ZKTeco's protocol, from its screens." }, "sa1"))
                .toMatchObject({ protocol: "ZKTECO", notesEn: "Speaks ZKTeco's protocol, from its screens." })
        })

        it("refuses another brand's name, capitals aside, and a brand that isn't there", async () => {
            await expect(Brands.update(await idOf("Anviz C2"), { name: "CONVOY", protocol: "HIKVISION" }, "sa1")).rejects.toEqual(refusal("BRAND_NAME_TAKEN"))
            await expect(Brands.update("nope", { name: "X", protocol: "ZKTECO" }, "sa1")).rejects.toEqual(refusal("BRAND_NOT_FOUND"))
        })
    })

    describe("retiring, putting back and deleting", () => {
        it("retires one a terminal has, which keeps it, and puts it back", async () => {
            const convoy = await idOf("Convoy")
            const retired = await Brands.retire(convoy, "sa1")
            expect(retired.retiredAt).not.toBeNull()
            expect((await db.query(`SELECT count(*)::int AS n FROM "AttendanceDevice" WHERE "brandId" = $1`, [convoy])).rows[0].n).toBe(2)
            await expect(Brands.retire(convoy, "sa1")).rejects.toEqual(refusal("BRAND_RETIRED"))
            // The retired go last.
            expect((await Brands.list()).at(-1)!.name).toBe("Convoy")
            expect((await Brands.restore(convoy, "sa1")).retiredAt).toBeNull()
            await expect(Brands.restore(convoy, "sa1")).rejects.toEqual(refusal("BRAND_NOT_RETIRED"))
            expect((await audits("RETIRE_TERMINAL_BRAND")).map(a => a.details)).toEqual([{ name: "Convoy" }])
            expect((await audits("RESTORE_TERMINAL_BRAND")).map(a => a.details)).toEqual([{ name: "Convoy" }])
        })

        it("deletes one no terminal has used, and refuses one a terminal has, which is retired instead", async () => {
            const anviz = await idOf("Anviz C2")
            await Brands.remove(anviz, "sa1")
            expect((await db.query(`SELECT count(*)::int AS n FROM "TerminalBrand" WHERE id = $1`, [anviz])).rows[0].n).toBe(0)
            expect(await audits("DELETE_TERMINAL_BRAND")).toEqual([{ entityId: anviz, details: { name: "Anviz C2", protocol: "HIKVISION" }, superAdminId: "sa1" }])
            await expect(Brands.remove(await idOf("Convoy"), "sa1")).rejects.toEqual(refusal("BRAND_IN_USE"))
            // The database refuses it too, should anything else try.
            await expect(db.query(`DELETE FROM "TerminalBrand" WHERE name = 'Convoy'`)).rejects.toThrow()
        })
    })
})
