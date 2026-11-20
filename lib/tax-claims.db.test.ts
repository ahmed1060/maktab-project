import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"
import { figuresAge } from "@/lib/tax-claims"

/**
 * A client's tax claims (CLIENT_PORTAL_PLAN.md §3, §3.5; PR 311), against a
 * real Postgres: what the Tax position section is given, who's given it,
 * late counted in the company's own days, and what the database holds a
 * claim to.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('t1', 't1@x', 'p', 'Tamer', 'One', 'TEAM_LEADER', 2026, 't1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', 't1'),
 ('u9', 'u9@x', 'p', 'Usama', 'Nine', 'EMPLOYEE', 2026, 'u9', 'c1', NULL),
 ('a2', 'a2@x', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`
// One is in Cairo and Two in Tokyo, a day ahead at the moment the tests read.
// Al Noor has seven open claims; Delta Foods a file with none open; Fresh
// Start nothing uploaded; Old Mill is archived; Going is deleted below.
const CLAIMS = `
UPDATE "Company" SET timezone = 'Africa/Cairo' WHERE id = 'c1';
UPDATE "Company" SET timezone = 'Asia/Tokyo' WHERE id = 'c2';
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt", "archivedAt") VALUES
 ('noor', 'c1', 'Al Noor', 'Omar', '0100', 'Cairo', now(), NULL),
 ('delta', 'c1', 'Delta Foods', 'Dina', '0101', 'Giza', now(), NULL),
 ('fresh', 'c1', 'Fresh Start', 'Farid', '0103', 'Giza', now(), NULL),
 ('old', 'c1', 'Old Mill', 'Ola', '0104', 'Giza', now(), now()),
 ('going', 'c1', 'Going', 'Gamal', '0105', 'Giza', now(), NULL),
 ('theirs', 'c2', 'Their client', 'Tarek', '0102', 'Tokyo', now(), NULL);
INSERT INTO "ClientTaxPosition"("clientId", "companyId", "asOf", "uploadedById", "uploadedByName", "uploadedAt", "updatedAt") VALUES
 ('noor', 'c1', '2026-10-14', 'a1', 'Amal One', '2026-10-15T09:00:00Z', now()),
 ('delta', 'c1', '2026-11-01', NULL, NULL, '2026-11-01T22:30:00Z', now()),
 ('old', 'c1', '2026-09-01', 'a1', 'Amal One', '2026-09-01T09:00:00Z', now()),
 ('going', 'c1', '2026-09-01', 'u9', 'Usama Nine', '2026-09-01T09:00:00Z', now()),
 ('theirs', 'c2', '2026-11-10', 'a2', 'Adel Two', '2026-11-10T09:00:00Z', now());
INSERT INTO "TaxClaim"(id, "companyId", "clientId", "claimNumber", "taxType", item, "originalAmount", "paidAmount", "remainingAmount", currency, status, "periodStart", "periodEnd", "dueDate") VALUES
 ('n1', 'c1', 'noor', '000101', 'دخل', 'إقرار ضريبة الدخل', 1000, 0, 1000, 'جنيه مصري', 'في انتظار السداد', '2025-01-01', '2025-12-31', '2026-04-30'),
 ('n2', 'c1', 'noor', '000102', 'قيمة مضافة', 'إقرار القيمة المضافة', 500.50, 200.25, 300.25, 'جنيه مصري', 'مسدد جزئيًا', '2026-08-01', '2026-08-31', '2026-09-30'),
 ('n3', 'c1', 'noor', '000103', 'قيمة مضافة', 'إقرار القيمة المضافة', 300, 0, 300, 'جنيه مصري', 'في انتظار السداد', '2026-10-01', '2026-10-31', '2026-11-17'),
 ('n4', 'c1', 'noor', '000104', NULL, 'مساهمة تكافلية', 50, 10, 40, NULL, NULL, NULL, NULL, '2026-12-31'),
 ('n5', 'c1', 'noor', '000105', 'دخل', 'إقرار ضريبة الدخل', 75, 0, 75, 'جنيه مصري', 'في انتظار السداد', '2026-01-01', '2026-03-31', '2026-11-18'),
 ('n6', 'c1', 'noor', '000106', 'دخل', 'إقرار ضريبة الدخل', 20, 0, 20, 'جنيه مصري', 'في انتظار السداد', '2026-04-01', '2026-06-30', '2026-11-19'),
 ('n7', 'c1', 'noor', '000099', 'دخل', 'إقرار ضريبة الدخل', 10, 0, 10, 'جنيه مصري', 'في انتظار السداد', '2026-07-01', '2026-09-30', '2026-11-19'),
 ('o1', 'c1', 'old', '7', 'دخل', 'إقرار ضريبة الدخل', 100, 0, 100, 'جنيه مصري', 'في انتظار السداد', '2025-01-01', '2025-12-31', '2026-01-31'),
 ('g1', 'c1', 'going', '1', 'دخل', 'إقرار ضريبة الدخل', 100, 0, 100, 'جنيه مصري', 'في انتظار السداد', '2025-01-01', '2025-12-31', '2026-01-31'),
 ('t1', 'c2', 'theirs', '1', 'دخل', 'إقرار ضريبة الدخل', 900, 0, 900, 'جنيه مصري', 'في انتظار السداد', '2025-01-01', '2025-12-31', '2026-11-17');
`
// 22:00 on 17 November in Cairo, 05:00 on the 18th in Tokyo.
const NOW = new Date("2026-11-17T20:00:00Z")
const FIVE = { page: 1, limit: 5, skip: 0 }

const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) as any
const leader = withGrants({ id: "t1", role: "TEAM_LEADER", companyId: "c1", name: "Tamer One" }) as any
const employee = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Ehab One" }) as any
const otherAdmin = withGrants({ id: "a2", role: "ADMIN", companyId: "c2", name: "Adel Two" }) as any
const superAdmin = { id: "sa", role: "SUPER_ADMIN", companyId: null, name: "Nizmo" } as any

describe.skipIf(!ADMIN_URL)("a client's tax claims, in Postgres", () => {
    const dbName = `tax_claims_test_${Date.now()}`
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
    }, 180_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    const claim = (over: string) => db.query(`INSERT INTO "TaxClaim"(id, "companyId", "clientId", "claimNumber", item, "originalAmount", "paidAmount", "remainingAmount", "periodStart", "periodEnd", "dueDate") VALUES ${over}`)

    describe("what the section is given", () => {
        it("gives the day the figures are from, who uploaded them, the totals and the first five claims", async () => {
            const got = await tax.taxPositionOf(admin, "noor", FIVE, NOW)
            expect(got.client).toEqual({ id: "noor", name: "Al Noor", archived: false })
            expect(got.today).toBe("2026-11-17")
            expect(got.position).toEqual({ asOf: "2026-10-14", uploadedOn: "2026-10-15", uploadedBy: "Amal One" })
            expect(got.totals).toEqual({ original: 1955.5, paid: 210.25, remaining: 1745.25, open: 7, late: 2 })
            expect([got.total, got.totalPages]).toEqual([7, 2])
            expect(got.claims).toHaveLength(5)
            expect(got.claims[1]).toEqual({
                id: "n2", claimNumber: "000102", item: "إقرار القيمة المضافة", taxType: "قيمة مضافة", registrationType: null,
                originalAmount: 500.5, paidAmount: 200.25, remainingAmount: 300.25, currency: "جنيه مصري", status: "مسدد جزئيًا",
                periodStart: "2026-08-01", periodEnd: "2026-08-31", dueDate: "2026-09-30", daysLate: 48,
            })
        })

        it("lists the longest overdue first, then by number, a page at a time", async () => {
            const ids = async (paging: { page: number; limit: number; skip: number }) => (await tax.taxPositionOf(admin, "noor", paging, NOW)).claims.map(c => [c.id, c.daysLate])
            // Due today isn't late; two due the same day go by their numbers, 000099 before 000106.
            expect(await ids(FIVE)).toEqual([["n1", 201], ["n2", 48], ["n3", 0], ["n5", 0], ["n7", 0]])
            expect(await ids({ page: 2, limit: 5, skip: 5 })).toEqual([["n6", 0], ["n4", 0]])
            expect((await ids({ page: 1, limit: 20, skip: 0 })).map(c => c[0])).toEqual(["n1", "n2", "n3", "n5", "n7", "n6", "n4"])
            // The totals are every page's.
            expect((await tax.taxPositionOf(admin, "noor", { page: 2, limit: 5, skip: 5 }, NOW)).totals).toEqual({ original: 1955.5, paid: 210.25, remaining: 1745.25, open: 7, late: 2 })
        })

        it("keeps a claim's number as text, and what the file left empty as empty", async () => {
            const all = (await tax.taxPositionOf(admin, "noor", { page: 1, limit: 20, skip: 0 }, NOW)).claims
            expect(all.find(c => c.id === "n7")?.claimNumber).toBe("000099")
            expect(all.find(c => c.id === "n4")).toMatchObject({ taxType: null, currency: null, status: null, periodStart: null, periodEnd: null, paidAmount: 10, remainingAmount: 40 })
        })

        it("says nothing is uploaded yet for a client with no file", async () => {
            expect(await tax.taxPositionOf(admin, "fresh", FIVE, NOW)).toEqual({
                client: { id: "fresh", name: "Fresh Start", archived: false }, today: "2026-11-17", position: null,
                totals: { original: 0, paid: 0, remaining: 0, open: 0, late: 0 }, claims: [], total: 0, totalPages: 0,
                // No one picked to write to yet (PR 343).
                accountant: { person: null, reach: "none" },
            })
        })

        it("keeps the day, at 0, where the file had no open claim, on the company's own calendar", async () => {
            const got = await tax.taxPositionOf(admin, "delta", FIVE, NOW)
            // Uploaded at 22:30 UTC on the 1st, which was the 2nd in Cairo; by someone whose name wasn't kept.
            expect(got.position).toEqual({ asOf: "2026-11-01", uploadedOn: "2026-11-02", uploadedBy: null })
            expect(got.totals).toEqual({ original: 0, paid: 0, remaining: 0, open: 0, late: 0 })
            expect(got.claims).toEqual([])
        })

        it("still shows an archived client's", async () => {
            const got = await tax.taxPositionOf(admin, "old", FIVE, NOW)
            expect(got.client.archived).toBe(true)
            expect(got.claims.map(c => c.id)).toEqual(["o1"])
        })

        it("counts late in the company's own days", async () => {
            // Due on the 17th: today in Cairo, yesterday in Tokyo.
            const cairo = await tax.taxPositionOf(admin, "noor", FIVE, NOW)
            expect(cairo.claims.find(c => c.id === "n3")?.daysLate).toBe(0)
            const tokyo = await tax.taxPositionOf(otherAdmin, "theirs", FIVE, NOW)
            expect(tokyo.today).toBe("2026-11-18")
            expect(tokyo.claims.map(c => [c.id, c.daysLate])).toEqual([["t1", 1]])
            expect(tokyo.totals.late).toBe(1)
        })
    })

    describe("who's given it", () => {
        it("is the client's own company's, for whoever may see tax positions", async () => {
            await expect(tax.taxPositionOf(admin, "theirs", FIVE, NOW)).rejects.toThrow("CLIENT_NOT_FOUND")
            await expect(tax.taxPositionOf(otherAdmin, "noor", FIVE, NOW)).rejects.toThrow("CLIENT_NOT_FOUND")
            await expect(tax.taxPositionOf(admin, "nobody", FIVE, NOW)).rejects.toThrow("CLIENT_NOT_FOUND")
            await expect(tax.taxPositionOf(admin, "", FIVE, NOW)).rejects.toThrow("TAX_CLIENT_REQUIRED")
            await expect(tax.taxPositionOf(admin, null, FIVE, NOW)).rejects.toThrow("TAX_CLIENT_REQUIRED")
        })

        it("isn't a Team Leader's or an Employee's, whose roles haven't the permission", async () => {
            await expect(tax.taxPositionOf(leader, "noor", FIVE, NOW)).rejects.toThrow("TAX_VIEW_REQUIRED")
            await expect(tax.taxPositionOf(employee, "noor", FIVE, NOW)).rejects.toThrow("TAX_VIEW_REQUIRED")
            // Nor does asking for another company's say whether it's there.
            await expect(tax.taxPositionOf(employee, "theirs", FIVE, NOW)).rejects.toThrow("TAX_VIEW_REQUIRED")
        })

        it("is the Super Admin's for any company's client, in that company's days", async () => {
            expect((await tax.taxPositionOf(superAdmin, "noor", FIVE, NOW)).today).toBe("2026-11-17")
            const theirs = await tax.taxPositionOf(superAdmin, "theirs", FIVE, NOW)
            expect([theirs.today, theirs.totals.late]).toEqual(["2026-11-18", 1])
        })
    })

    describe("figures getting old (§4.3, PR 321)", () => {
        // The Clients list's rows, as its route reads them.
        const rows = () => prisma.client.findMany({ select: { id: true, companyId: true, archivedAt: true, taxPosition: { select: { asOf: true } } } })

        it("says how old the figures are for clients whose day is 30 days back or more, and for no others", async () => {
            // Al Noor's are from 14 October, 34 days before the 17th in Cairo; Going's from 1 September.
            expect(Object.fromEntries(await tax.taxFiguresOld(await rows(), NOW))).toEqual({ noor: 34, going: 77 })
        })

        it("leaves out an archived client, a client with no file, and figures under 30 days old", async () => {
            const old = await tax.taxFiguresOld(await rows(), NOW)
            // Old Mill is archived, with figures 77 days old; Fresh Start has no file; Delta Foods' are 16 days old,
            // and Their client's 8, in Tokyo.
            for (const id of ["old", "fresh", "delta", "theirs"]) expect(old.has(id), id).toBe(false)
        })

        it("counts each company's clients to that company's own today", async () => {
            // The same day for both: 29 days back in Cairo, where it's still the 17th, and 30 in Tokyo, where it's the 18th.
            await db.query(`INSERT INTO "ClientTaxPosition"("clientId", "companyId", "asOf", "uploadedAt", "updatedAt") VALUES ('fresh', 'c1', '2026-10-19', now(), now())`)
            await db.query(`UPDATE "ClientTaxPosition" SET "asOf" = '2026-10-19' WHERE "clientId" = 'theirs'`)
            try {
                const old = await tax.taxFiguresOld(await rows(), NOW)
                expect(old.has("fresh")).toBe(false)
                expect(old.get("theirs")).toBe(30)
                // A day later it's 30 in Cairo too.
                expect((await tax.taxFiguresOld(await rows(), new Date("2026-11-18T20:00:00Z"))).get("fresh")).toBe(30)
            } finally {
                await db.query(`DELETE FROM "ClientTaxPosition" WHERE "clientId" = 'fresh'`)
                await db.query(`UPDATE "ClientTaxPosition" SET "asOf" = '2026-11-10' WHERE "clientId" = 'theirs'`)
            }
        })

        it("agrees with the client's own Tax position, which is given both days", async () => {
            const got = await tax.taxPositionOf(admin, "noor", FIVE, NOW)
            expect(figuresAge(got.position!.asOf, got.today)).toBe(34)
        })

        it("says nothing where no client has a file", async () => {
            expect((await tax.taxFiguresOld([{ id: "x", companyId: "c1", archivedAt: null, taxPosition: null }], NOW)).size).toBe(0)
            expect((await tax.taxFiguresOld([], NOW)).size).toBe(0)
        })
    })

    describe("what the database holds to", () => {
        it("has Row Level Security on both tables", async () => {
            const { rows } = await db.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('TaxClaim', 'ClientTaxPosition') ORDER BY relname`)
            expect(rows).toEqual([{ relname: "ClientTaxPosition", relrowsecurity: true }, { relname: "TaxClaim", relrowsecurity: true }])
        })

        it("has a claim's number once for its client, and lets another client have the same", async () => {
            await expect(claim(`('dup', 'c1', 'noor', '000101', 'x', 5, 0, 5, NULL, NULL, '2026-12-31')`)).rejects.toThrow(/TaxClaim_clientId_claimNumber_key/)
            await claim(`('same', 'c1', 'delta', '000101', 'x', 5, 0, 5, NULL, NULL, '2026-12-31')`)
            await db.query(`DELETE FROM "TaxClaim" WHERE id = 'same'`)
        })

        it("refuses amounts that don't add up, a negative one, and a claim with nothing left to pay", async () => {
            await expect(claim(`('bad1', 'c1', 'delta', '1', 'x', 100, 30, 60, NULL, NULL, '2026-12-31')`)).rejects.toThrow(/TaxClaim_amounts/)
            await expect(claim(`('bad2', 'c1', 'delta', '2', 'x', 100, -10, 110, NULL, NULL, '2026-12-31')`)).rejects.toThrow(/TaxClaim_amounts/)
            await expect(claim(`('bad3', 'c1', 'delta', '3', 'x', 100, 100, 0, NULL, NULL, '2026-12-31')`)).rejects.toThrow(/TaxClaim_amounts/)
            // To the piastre.
            await expect(claim(`('bad4', 'c1', 'delta', '4', 'x', 100.01, 0, 100, NULL, NULL, '2026-12-31')`)).rejects.toThrow(/TaxClaim_amounts/)
        })

        it("refuses a claim with no number or no item, and a period that ends before it starts", async () => {
            await expect(claim(`('bad5', 'c1', 'delta', '  ', 'x', 5, 0, 5, NULL, NULL, '2026-12-31')`)).rejects.toThrow(/TaxClaim_named/)
            await expect(claim(`('bad6', 'c1', 'delta', '6', '', 5, 0, 5, NULL, NULL, '2026-12-31')`)).rejects.toThrow(/TaxClaim_named/)
            await expect(claim(`('bad7', 'c1', 'delta', '7', 'x', 5, 0, 5, '2026-03-31', '2026-01-01', '2026-12-31')`)).rejects.toThrow(/TaxClaim_period/)
            expect((await db.query(`SELECT count(*)::int AS n FROM "TaxClaim" WHERE "clientId" = 'delta'`)).rows[0].n).toBe(0)
        })

        it("keeps the uploader's name when their account goes, and lets a client's claims go with it", async () => {
            await db.query(`DELETE FROM "User" WHERE id = 'u9'`)
            expect((await db.query(`SELECT "uploadedById", "uploadedByName" FROM "ClientTaxPosition" WHERE "clientId" = 'going'`)).rows).toEqual([{ uploadedById: null, uploadedByName: "Usama Nine" }])
            expect((await tax.taxPositionOf(admin, "going", FIVE, NOW)).position?.uploadedBy).toBe("Usama Nine")
            await db.query(`DELETE FROM "Client" WHERE id = 'going'`)
            expect((await db.query(`SELECT (SELECT count(*) FROM "TaxClaim" WHERE "clientId" = 'going')::int AS claims, (SELECT count(*) FROM "ClientTaxPosition" WHERE "clientId" = 'going')::int AS positions`)).rows).toEqual([{ claims: 0, positions: 0 }])
        })
    })
})
