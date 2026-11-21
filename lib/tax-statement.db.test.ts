import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * What the tax position statement reads for the company's people
 * (CLIENT_PORTAL_PLAN.md §8, §12 step 12b; PR 353), against a real Postgres:
 * the client's claims as the client's area reads them, its company's name and
 * logo, for whoever may see tax positions, and only the company's own client
 * unless they're a Super Admin. All names and figures are made up.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Nile Accounts', now()), ('c2', 'Other Office', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x.co', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x.co', 'p', 'Emad', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('a2', 'a2@x.co', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`
const OFFICES = `
INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES ('sa', 'sam@nizmo.co', 'p', 'Sam', 'Admin', 'sa', now());
UPDATE "Company" SET timezone = 'Africa/Cairo', "logoUrl" = 'https://example.com/nile.png' WHERE id = 'c1';
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt", "archivedAt") VALUES
 ('noor', 'c1', 'Al Noor Trading', 'Omar', '0100', 'Cairo', now(), NULL),
 ('old', 'c1', 'Old Client', 'Ola', '0101', 'Giza', now(), now()),
 ('fresh', 'c1', 'Fresh Client', 'Fady', '0102', 'Giza', now(), NULL),
 ('theirs', 'c2', 'Their Client', 'Tarek', '0103', 'Giza', now(), NULL);
INSERT INTO "ClientTaxPosition"("clientId", "companyId", "asOf", "updatedAt") VALUES
 ('noor', 'c1', '2026-11-16', now()), ('old', 'c1', '2026-10-01', now()), ('theirs', 'c2', '2026-11-10', now());
INSERT INTO "TaxClaim"(id, "companyId", "clientId", "claimNumber", item, "originalAmount", "paidAmount", "remainingAmount", currency, "dueDate", "periodStart", "periodEnd") VALUES
 ('n1', 'c1', 'noor', '000118000001', 'إقرار القيمة المضافة', 7200, 0, 7200, 'جنيه مصري', '2026-10-31', '2026-09-01', '2026-09-30'),
 ('n2', 'c1', 'noor', '000118000002', 'اقرار القيمه المضافه', 12400, 4000, 8400, 'جنيه مصري', '2025-02-28', '2025-01-01', '2025-01-31'),
 ('n3', 'c1', 'noor', '000118000003', 'إقرار تجاري', 500, 200, 300, 'جنيه مصري', '2026-12-15', NULL, NULL),
 ('o1', 'c1', 'old', '000118000004', 'إقرار ضريبة الدخل', 1000, 0, 1000, 'جنيه مصري', '2026-04-30', NULL, NULL),
 ('t1', 'c2', 'theirs', '000118000005', 'إقرار تجاري', 900, 0, 900, 'جنيه مصري', '2026-01-31', NULL, NULL);
`
// Just past midnight on the 21st in Cairo, where the company is: still the 20th in UTC.
const NOW = new Date("2026-11-20T22:30:00Z")

const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) as any
const employee = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Emad One" }) as any
const otherAdmin = withGrants({ id: "a2", role: "ADMIN", companyId: "c2", name: "Adel Two" }) as any
const superAdmin = { id: "sa", role: "SUPER_ADMIN", companyId: null, name: "Sam Admin" } as any

describe.skipIf(!ADMIN_URL)("the tax position statement for the company's people, in Postgres", () => {
    const dbName = `tax_statement_test_${Date.now()}`
    let db: Client
    let tax: typeof import("@/lib/services/tax-claim.service")
    let prisma: typeof import("@/lib/prisma").prisma

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`CREATE DATABASE ${dbName}`)
        await a.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(OFFICES)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        tax = await import("@/lib/services/tax-claim.service")
        prisma = (await import("@/lib/prisma")).prisma
    }, 180_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    it("the client's name, its company's name and logo, and its claims as the client's area reads them", async () => {
        const statement = await tax.taxStatementOf(admin, "noor", NOW)
        expect(statement.client).toBe("Al Noor Trading")
        expect(statement.company).toEqual({ name: "Nile Accounts", logoUrl: "https://example.com/nile.png" })
        // The same figures the client's own statement draws.
        expect(statement.position).toEqual(await tax.portalTaxPosition({ companyId: "c1", clientId: "noor" }, NOW))
        expect(statement.position.today).toBe("2026-11-21")
        expect(statement.position.asOf).toBe("2026-11-16")
        expect(statement.position.totals).toEqual({ original: 20100, paid: 4200, remaining: 15900, open: 3, late: 2, oldestDelay: statement.position.totals.oldestDelay })
        // The portal's two spellings of one item are one item.
        expect(statement.position.items.map(item => [item.item, item.claims.length])).toEqual([["إقرار القيمة المضافة", 2], ["إقرار تجاري", 1]])
    })

    it("an archived client's, whose figures stay; and one with no file yet has no day", async () => {
        expect((await tax.taxStatementOf(admin, "old", NOW)).position.totals.open).toBe(1)
        const fresh = await tax.taxStatementOf(admin, "fresh", NOW)
        expect(fresh.position.asOf).toBeNull()
        expect(fresh.position.totals.open).toBe(0)
    })

    it("only for whoever may see tax positions", async () => {
        await expect(tax.taxStatementOf(employee, "noor", NOW)).rejects.toThrow("TAX_VIEW_REQUIRED")
    })

    it("another company's client isn't there, whatever the address says; a Super Admin reads any", async () => {
        await expect(tax.taxStatementOf(otherAdmin, "noor", NOW)).rejects.toThrow("CLIENT_NOT_FOUND")
        await expect(tax.taxStatementOf(admin, "theirs", NOW)).rejects.toThrow("CLIENT_NOT_FOUND")
        await expect(tax.taxStatementOf(admin, "nobody", NOW)).rejects.toThrow("CLIENT_NOT_FOUND")
        await expect(tax.taxStatementOf(admin, "", NOW)).rejects.toThrow("TAX_CLIENT_REQUIRED")
        const theirs = await tax.taxStatementOf(superAdmin, "theirs", NOW)
        expect(theirs.company).toEqual({ name: "Other Office", logoUrl: null })
        expect(theirs.position.totals.open).toBe(1)
    })
})
