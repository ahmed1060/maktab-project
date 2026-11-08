import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { parseModuleIcons } from "./modules"

/**
 * A module's icon by its Phosphor name, where it was an emoji (UI_PLAN.md
 * §4.4, DESIGN.md §6), against a real Postgres: what companies chose before
 * is mapped. Each emoji that was a module's default until the side bar moved
 * onto the building blocks becomes the icon that took its place there; any
 * other goes, and the module shows its own. A module's own icon isn't kept,
 * and nor is anything for a module there's no longer. Names are left alone.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const ICON_NAMES = "20261202000000_module_icon_names"

/** What companies had chosen, as the Modules tab and the API stored it before. */
const CHOSEN = `
INSERT INTO "Company"(id, name, "updatedAt", "moduleIcons", "moduleLabels") VALUES
 ('mixed', 'Mixed', now(), '{"clients": "🚚", "records": "📊", "tasks": "🔧"}', '{"clients": "Vendors"}'),
 ('own', 'Own', now(), '{"records": "🗂️", "locations": "🗺", "employees": "👥", "requests": "📩"}', NULL),
 ('swapped', 'Swapped', now(), '{"costs": "✅", "obligations": "📩", "dashboard": "💰", "employees": "📌"}', '{"costs": "Expenses"}'),
 ('stray', 'Stray', now(), '{"dayoff": "📊", "tasks": 5, "requests": "📌", "clients": "🗺️"}', NULL),
 ('named', 'Named', now(), '{"clients": "truck", "tasks": "check-square"}', NULL),
 ('other', 'Other', now(), '{"clients": "🏥", "records": "📁"}', '{"records": "Files"}'),
 ('none', 'None', now(), NULL, '{"clients": "Suppliers"}'),
 ('json-null', 'Json null', now(), 'null', NULL);
`

describe.skipIf(!ADMIN_URL)("a module's icon by its name, in Postgres", () => {
    const dbName = `module_icons_test_${Date.now()}`
    let db: Client
    const company = async (id: string) => (await db.query(`SELECT "moduleIcons", "moduleLabels", "moduleIcons" IS NULL AS "sqlNull" FROM "Company" WHERE id = $1`, [id])).rows[0]

    beforeAll(async () => {
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`CREATE DATABASE ${dbName}`)
        await admin.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        expect(MIGRATIONS).toContain(ICON_NAMES)
        for (const m of MIGRATIONS) {
            if (m === ICON_NAMES) await db.query(CHOSEN)
            await db.query(sql(m))
        }
    }, 180_000)

    afterAll(async () => {
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await admin.end()
    })

    it("turns an emoji that was a module's default into the icon that took its place, for another module", async () => {
        // 📊 was Dashboard's: kept for Records as Dashboard's icon now. 🚚 was
        // Clients' own, and 🔧 no module's.
        expect(await company("mixed")).toEqual({ moduleIcons: { records: "squares-four" }, moduleLabels: { clients: "Vendors" }, sqlNull: false })
        expect(await company("swapped")).toEqual({
            moduleIcons: { costs: "check-square", obligations: "tray", dashboard: "coins", employees: "push-pin" },
            moduleLabels: { costs: "Expenses" }, sqlNull: false,
        })
    })

    it("keeps nothing where that's the module's own icon, with or without the emoji's variation mark", async () => {
        expect(await company("own")).toEqual({ moduleIcons: null, moduleLabels: null, sqlNull: true })
    })

    it("drops any other emoji, so the module shows its own, and keeps the company's names", async () => {
        expect(await company("other")).toEqual({ moduleIcons: null, moduleLabels: { records: "Files" }, sqlNull: true })
    })

    it("drops what's for no module, and what isn't text", async () => {
        expect(await company("stray")).toEqual({ moduleIcons: { requests: "push-pin", clients: "map-trifold" }, moduleLabels: null, sqlNull: false })
    })

    it("leaves names as they are, but for a module's own", async () => {
        expect(await company("named")).toEqual({ moduleIcons: { clients: "truck" }, moduleLabels: null, sqlNull: false })
    })

    it("leaves a company with none as it was", async () => {
        expect(await company("none")).toEqual({ moduleIcons: null, moduleLabels: { clients: "Suppliers" }, sqlNull: true })
        expect(await company("json-null")).toEqual({ moduleIcons: null, moduleLabels: null, sqlNull: false })
    })

    it("leaves only what the code reads as it stands", async () => {
        const { rows } = await db.query(`SELECT id, "moduleIcons" FROM "Company" WHERE "moduleIcons" IS NOT NULL AND jsonb_typeof("moduleIcons") = 'object'`)
        for (const row of rows) expect(parseModuleIcons(row.moduleIcons), row.id).toEqual(row.moduleIcons)
    })
})
