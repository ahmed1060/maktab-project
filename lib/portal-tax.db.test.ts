import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { daysLate } from "@/lib/tax-claims"

/**
 * What the client's area reads of a client's tax position
 * (CLIENT_PORTAL_PLAN.md §6, §12 step 8a; PR 336), against a real Postgres:
 * the session's own client's claims alone, late counted in the company's own
 * days, by item and by how late; and nothing before the first upload.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
`
// One is in Cairo, where it's already the 18th when the tests read; Two is in
// Tokyo. Al Noor has five open claims; Delta Foods, its neighbour, one; Fresh
// Start nothing uploaded.
const CLAIMS = `
UPDATE "Company" SET timezone = 'Africa/Cairo' WHERE id = 'c1';
UPDATE "Company" SET timezone = 'Asia/Tokyo' WHERE id = 'c2';
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES
 ('noor', 'c1', 'Al Noor', 'Omar', '0100', 'Cairo', now()),
 ('delta', 'c1', 'Delta Foods', 'Dina', '0101', 'Giza', now()),
 ('fresh', 'c1', 'Fresh Start', 'Farid', '0103', 'Giza', now()),
 ('theirs', 'c2', 'Their client', 'Tarek', '0102', 'Tokyo', now());
INSERT INTO "ClientTaxPosition"("clientId", "companyId", "asOf", "uploadedById", "uploadedByName", "uploadedAt", "updatedAt") VALUES
 ('noor', 'c1', '2026-10-14', NULL, 'Amal One', '2026-10-15T09:00:00Z', now()),
 ('delta', 'c1', '2026-11-01', NULL, NULL, '2026-11-01T09:00:00Z', now()),
 ('theirs', 'c2', '2026-11-10', NULL, NULL, '2026-11-10T09:00:00Z', now());
INSERT INTO "TaxClaim"(id, "companyId", "clientId", "claimNumber", "taxType", item, "originalAmount", "paidAmount", "remainingAmount", currency, status, "periodStart", "periodEnd", "dueDate") VALUES
 ('n1', 'c1', 'noor', '000101', 'دخل', 'إقرار ضريبة الدخل', 1000, 0, 1000, 'جنيه مصري', 'في انتظار السداد', '2025-01-01', '2025-12-31', '2026-04-30'),
 ('n2', 'c1', 'noor', '000102', 'قيمة مضافة', 'إقرار القيمة المضافة', 500.50, 200.25, 300.25, 'جنيه مصري', 'مسدد جزئيًا', '2026-08-01', '2026-08-31', '2026-09-30'),
 ('n3', 'c1', 'noor', '000103', 'قيمة مضافة', 'إقرار القيمة المضافة', 300, 0, 300, 'جنيه مصري', 'في انتظار السداد', '2026-10-01', '2026-10-31', '2026-11-17'),
 ('n4', 'c1', 'noor', '000104', NULL, 'مساهمة تكافلية', 50, 10, 40, NULL, NULL, NULL, NULL, '2026-12-31'),
 ('n5', 'c1', 'noor', '000105', 'دخل', 'إقرار ضريبة الدخل', 75, 0, 75, 'جنيه مصري', 'في انتظار السداد', '2023-01-01', '2023-12-31', '2024-01-31'),
 ('d1', 'c1', 'delta', '9', 'دخل', 'إقرار ضريبة الدخل', 999, 0, 999, 'جنيه مصري', 'في انتظار السداد', '2025-01-01', '2025-12-31', '2026-01-01'),
 ('t1', 'c2', 'theirs', '1', 'دخل', 'إقرار ضريبة الدخل', 900, 0, 900, 'جنيه مصري', 'في انتظار السداد', '2025-01-01', '2025-12-31', '2026-11-17');
`
// 22:30 on 17 November in UTC: 00:30 on the 18th in Cairo.
const NOW = new Date("2026-11-17T22:30:00Z")
const TODAY = "2026-11-18"

describe.skipIf(!ADMIN_URL)("what the client's area reads of a tax position, in Postgres", () => {
    const dbName = `portal_tax_test_${Date.now()}`
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
        await db.query(CLAIMS)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        tax = await import("@/lib/services/tax-claim.service")
        prisma = (await import("@/lib/prisma")).prisma
    }, 120_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    const read = (clientId: string, companyId = "c1") => tax.portalTaxPosition({ companyId, clientId }, NOW)
    const why = (p: Promise<unknown>) => p.then(() => "read", (error: Error) => error.message)

    it("in the company's own days: already the 18th in Cairo", async () => {
        const position = await read("noor")
        expect(position.today).toBe(TODAY)
        expect(position.asOf).toBe("2026-10-14")
        // Due on the 17th: late a day in Cairo, though it's still the 17th in UTC.
        const n3 = position.items.flatMap(i => i.claims).find(c => c.id === "n3")
        expect(n3).toMatchObject({ claimNumber: "000103", dueDate: "2026-11-17", daysLate: 1 })
    })

    it("what the client's own claims come to, and nobody else's", async () => {
        const position = await read("noor")
        expect(position.totals).toEqual({ original: 1925.5, paid: 210.25, remaining: 1715.25, open: 5, late: 4, oldestDelay: daysLate("2024-01-31", TODAY) })
        expect(position.items.flatMap(i => i.claims).map(c => c.id).sort()).toEqual(["n1", "n2", "n3", "n4", "n5"])
    })

    it("by item, the largest remaining first, each item's claims the oldest due first", async () => {
        const { items } = await read("noor")
        expect(items.map(i => [i.item, i.remaining, i.claims.map(c => c.id), i.earliestDue, i.badges])).toEqual([
            ["إقرار ضريبة الدخل", 1075, ["n5", "n1"], "2024-01-31", ["late"]],
            ["إقرار القيمة المضافة", 600.25, ["n2", "n3"], "2026-09-30", ["late", "partly_paid"]],
            ["مساهمة تكافلية", 40, ["n4"], "2026-12-31", ["partly_paid"]],
        ])
    })

    it("by how late, from what's not due yet on", async () => {
        const { late } = await read("noor")
        expect(late).toEqual([
            { group: "not_due", remaining: 40, count: 1 },
            { group: "under_6_months", remaining: 600.25, count: 2 },
            { group: "6_to_12_months", remaining: 1000, count: 1 },
            { group: "1_to_2_years", remaining: 0, count: 0 },
            { group: "over_2_years", remaining: 75, count: 1 },
        ])
    })

    it("before the first upload: nothing owed, and no day the figures are from", async () => {
        const position = await read("fresh")
        expect(position).toMatchObject({ today: TODAY, asOf: null, items: [], totals: { original: 0, paid: 0, remaining: 0, open: 0, late: 0, oldestDelay: 0 } })
    })

    it("only the session's own company's client: another's reads as not there", async () => {
        expect(await why(read("theirs", "c1"))).toBe("CLIENT_NOT_FOUND")
        expect(await why(read("noor", "c2"))).toBe("CLIENT_NOT_FOUND")
        expect(await why(read("nobody"))).toBe("CLIENT_NOT_FOUND")
    })

    it("in another company's days for its own client: Tokyo's", async () => {
        const position = await read("theirs", "c2")
        expect(position.today).toBe("2026-11-18")
        expect(position.totals).toMatchObject({ remaining: 900, open: 1, late: 1 })
    })
})
