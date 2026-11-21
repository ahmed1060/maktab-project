import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"
import type { ClaimDraft } from "@/lib/tax-file"

/**
 * Saving the tax portal's file (CLIENT_PORTAL_PLAN.md §4.1, §15; PR 315),
 * against a real Postgres: what a file is checked against, each upload
 * replacing the last in one go, a save refused where the claims changed
 * since they were read, the right client, and the server checking again.
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
 ('a2', 'a2@x', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`
// One is in Cairo and Two in Tokyo, a day ahead at the moment the tests read.
// Al Noor has a file with three open claims; Old Mill is archived, with one.
// The rest have nothing uploaded yet, each for its own tests.
const CLIENTS = `
UPDATE "Company" SET timezone = 'Africa/Cairo' WHERE id = 'c1';
UPDATE "Company" SET timezone = 'Asia/Tokyo' WHERE id = 'c2';
INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES ('sa', 'sa@x', 'p', 'Sam', 'Admin', 'sa', now());
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt", "archivedAt") VALUES
 ('noor', 'c1', 'Al Noor', 'Omar', '0100', 'Cairo', now(), NULL),
 ('fresh', 'c1', 'Fresh Start', 'Farid', '0101', 'Giza', now(), NULL),
 ('delta', 'c1', 'Delta Foods', 'Dina', '0102', 'Giza', now(), NULL),
 ('race', 'c1', 'Race', 'Rami', '0103', 'Giza', now(), NULL),
 ('named', 'c1', 'Named', 'Nada', '0104', 'Giza', now(), NULL),
 ('many', 'c1', 'Many Claims', 'Mona', '0105', 'Giza', now(), NULL),
 ('closing', 'c1', 'Closing', 'Karim', '0106', 'Giza', now(), NULL),
 ('old', 'c1', 'Old Mill', 'Ola', '0107', 'Giza', now(), now()),
 ('theirs', 'c2', 'Their client', 'Tarek', '0108', 'Tokyo', now(), NULL);
INSERT INTO "ClientTaxPosition"("clientId", "companyId", "asOf", "uploadedById", "uploadedByName", "uploadedAt", "updatedAt") VALUES
 ('noor', 'c1', '2026-10-14', 'a1', 'Amal One', '2026-10-15T09:00:00Z', now()),
 ('old', 'c1', '2026-09-01', 'a1', 'Amal One', '2026-09-01T09:00:00Z', now());
INSERT INTO "TaxClaim"(id, "companyId", "clientId", "claimNumber", "taxType", item, "originalAmount", "paidAmount", "remainingAmount", currency, status, "periodStart", "periodEnd", "dueDate") VALUES
 ('n1', 'c1', 'noor', '000101', 'دخل', 'إقرار ضريبة الدخل', 1000, 0, 1000, 'جنيه مصري', 'في انتظار السداد', '2025-01-01', '2025-12-31', '2026-04-30'),
 ('n2', 'c1', 'noor', '000102', 'قيمة مضافة', 'إقرار القيمة المضافة', 500.50, 200.25, 300.25, 'جنيه مصري', 'مسدد جزئيًا', '2026-08-01', '2026-08-31', '2026-09-30'),
 ('n3', 'c1', 'noor', '000103', NULL, 'مساهمة تكافلية', 50, 0, 50, NULL, NULL, NULL, NULL, '2026-12-31'),
 ('o1', 'c1', 'old', '7', 'دخل', 'إقرار ضريبة الدخل', 100, 0, 100, 'جنيه مصري', 'في انتظار السداد', '2025-01-01', '2025-12-31', '2026-01-31');
`
// 22:00 on 17 November in Cairo, 05:00 on the 18th in Tokyo.
const NOW = new Date("2026-11-17T20:00:00Z")
const FIVE = { page: 1, limit: 5, skip: 0 }

const N1: ClaimDraft = {
    claimNumber: "000101", item: "إقرار ضريبة الدخل", taxType: "دخل", registrationType: null, originalAmount: 1000, paidAmount: 0, remainingAmount: 1000,
    currency: "جنيه مصري", status: "في انتظار السداد", periodStart: "2025-01-01", periodEnd: "2025-12-31", dueDate: "2026-04-30",
}
const N2: ClaimDraft = {
    claimNumber: "000102", item: "إقرار القيمة المضافة", taxType: "قيمة مضافة", registrationType: null, originalAmount: 500.5, paidAmount: 200.25, remainingAmount: 300.25,
    currency: "جنيه مصري", status: "مسدد جزئيًا", periodStart: "2026-08-01", periodEnd: "2026-08-31", dueDate: "2026-09-30",
}
const N3: ClaimDraft = {
    claimNumber: "000103", item: "مساهمة تكافلية", taxType: null, registrationType: null, originalAmount: 50, paidAmount: 0, remainingAmount: 50,
    currency: null, status: null, periodStart: null, periodEnd: null, dueDate: "2026-12-31",
}
const claim = (claimNumber: string, over: Partial<ClaimDraft> = {}): ClaimDraft => ({ ...N1, claimNumber, ...over })
// What a check screen sends. Confirmed, so only the tests about the file's company are about it.
const upload = (clientId: string, uploads: number, claims: unknown[], over: Record<string, unknown> = {}) =>
    ({ clientId, uploads, asOf: "2026-11-17", fileName: "claims - 2026-11-17.xlsx", fileCompany: "", confirmed: true, claims, ...over })

const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) as any
const leader = withGrants({ id: "t1", role: "TEAM_LEADER", companyId: "c1", name: "Tamer One" }) as any
const otherAdmin = withGrants({ id: "a2", role: "ADMIN", companyId: "c2", name: "Adel Two" }) as any
const superAdmin = { id: "sa", role: "SUPER_ADMIN", companyId: null, name: "Nizmo" } as any

describe.skipIf(!ADMIN_URL)("saving the tax portal's file, in Postgres", () => {
    const dbName = `tax_upload_test_${Date.now()}`
    let db: Client
    let tax: typeof import("@/lib/services/tax-claim.service")
    let prisma: typeof import("@/lib/prisma").prisma

    const stored = async (clientId: string) => (await db.query(`
        SELECT id, "claimNumber", "originalAmount"::float8 AS original, "paidAmount"::float8 AS paid, "remainingAmount"::float8 AS remaining, "companyId"
        FROM "TaxClaim" WHERE "clientId" = $1 ORDER BY "claimNumber"`, [clientId])).rows
    const position = async (clientId: string) => (await db.query(`
        SELECT to_char("asOf", 'YYYY-MM-DD') AS "asOf", "uploadedById", "uploadedByName", to_char("uploadedAt", 'YYYY-MM-DD"T"HH24:MI') AS "uploadedAt", "fileCompany", uploads, "companyId"
        FROM "ClientTaxPosition" WHERE "clientId" = $1`, [clientId])).rows[0]
    const logged = async (clientId: string) => (await db.query(`SELECT action, "entityType", details, "userId", "superAdminId" FROM "AuditLog" WHERE "entityId" = $1 ORDER BY "createdAt"`, [clientId])).rows
    const all = async (clientId: string) => [await stored(clientId), await position(clientId), (await logged(clientId)).length]

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
        await db.query(CLIENTS)
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

    describe("what a file is checked against", () => {
        it("gives every claim the client has, as a file would give them, with the count of files and the company's today", async () => {
            expect(await tax.taxClaimsNow(admin, "noor", NOW)).toEqual({
                client: { id: "noor", name: "Al Noor" }, today: "2026-11-17", uploads: 1, fileCompany: null, claims: [N1, N2, N3],
            })
        })

        it("gives nothing, and no file yet, for a client that has none", async () => {
            expect(await tax.taxClaimsNow(admin, "fresh", NOW)).toEqual({ client: { id: "fresh", name: "Fresh Start" }, today: "2026-11-17", uploads: 0, fileCompany: null, claims: [] })
        })

        it("is for whoever may upload, of a client in use in their own company", async () => {
            await expect(tax.taxClaimsNow(leader, "noor", NOW)).rejects.toThrow("TAX_MANAGE_REQUIRED")
            await expect(tax.taxClaimsNow(admin, "theirs", NOW)).rejects.toThrow("CLIENT_NOT_FOUND")
            await expect(tax.taxClaimsNow(admin, "nobody", NOW)).rejects.toThrow("CLIENT_NOT_FOUND")
            // An address that isn't an id is nobody's, and isn't asked of the database.
            await expect(tax.taxClaimsNow(admin, "no\u0000body", NOW)).rejects.toThrow("CLIENT_NOT_FOUND")
            await expect(tax.taxClaimsNow(admin, "", NOW)).rejects.toThrow("TAX_CLIENT_REQUIRED")
            await expect(tax.taxClaimsNow(admin, null, NOW)).rejects.toThrow("TAX_CLIENT_REQUIRED")
            await expect(tax.taxClaimsNow(admin, "old", NOW)).rejects.toThrow("CLIENT_ARCHIVED")
            // Nor does asking for another company's say whether it's there.
            await expect(tax.taxClaimsNow(leader, "theirs", NOW)).rejects.toThrow("TAX_MANAGE_REQUIRED")
        })

        it("is the Super Admin's for any company's client, in that company's days", async () => {
            expect(await tax.taxClaimsNow(superAdmin, "theirs", NOW)).toMatchObject({ client: { id: "theirs" }, today: "2026-11-18", uploads: 0 })
        })
    })

    describe("the first file", () => {
        const partly = { originalAmount: 21088.26, paidAmount: 7365, remainingAmount: 13723.26, status: "مسدد جزئياً" }

        it("has every claim new, and keeps the day, who uploaded and the company it named", async () => {
            const saved = await tax.saveTaxFile(admin, upload("fresh", 0, [claim("000201"), claim("000202", partly)], { fileCompany: "Fresh Start", confirmed: false }), NOW)
            expect(saved).toEqual({ added: 2, changed: 0, gone: 0, claims: 2, uploads: 1, email: { state: "off" } })
            expect((await stored("fresh")).map(c => [c.claimNumber, c.original, c.paid, c.remaining, c.companyId])).toEqual([
                ["000201", 1000, 0, 1000, "c1"], ["000202", 21088.26, 7365, 13723.26, "c1"],
            ])
            expect(await position("fresh")).toEqual({
                asOf: "2026-11-17", uploadedById: "a1", uploadedByName: "Amal One", uploadedAt: "2026-11-17T20:00", fileCompany: "Fresh Start", uploads: 1, companyId: "c1",
            })
        })

        it("writes one audit log entry, on the client: the file's name, the day and the counts", async () => {
            expect(await logged("fresh")).toEqual([{
                action: "UPDATE_TAX_POSITION", entityType: "VENDOR", userId: "a1", superAdminId: null,
                details: { name: "Fresh Start", fileName: "claims - 2026-11-17.xlsx", asOf: "2026-11-17", added: 2, changed: 0, removed: 0, claims: 2 },
            }])
        })

        it("is the client's tax position at once", async () => {
            const got = await tax.taxPositionOf(admin, "fresh", FIVE, NOW)
            expect(got.position).toEqual({ asOf: "2026-11-17", uploadedOn: "2026-11-17", uploadedBy: "Amal One" })
            expect(got.totals).toMatchObject({ remaining: 14723.26, open: 2 })
            expect(got.claims.map(c => c.claimNumber)).toEqual(["000201", "000202"])
        })

        it("has nothing changed by the same file again but the day and the count of files: each claim keeps its row", async () => {
            const before = await stored("fresh")
            const saved = await tax.saveTaxFile(admin, upload("fresh", 1, [claim("000201"), claim("000202", partly)], { asOf: "2026-11-16" }), new Date("2026-11-17T21:00:00Z"))
            expect(saved).toEqual({ added: 0, changed: 0, gone: 0, claims: 2, uploads: 2, email: { state: "off" } })
            expect(await stored("fresh")).toEqual(before)
            expect(await position("fresh")).toMatchObject({ asOf: "2026-11-16", uploadedAt: "2026-11-17T21:00", uploads: 2 })
            expect((await logged("fresh")).map(entry => entry.details.added)).toEqual([2, 0])
        })
    })

    describe("each upload replaces the last", () => {
        it("writes what's new and what changed, lets what the file hasn't go, and leaves the rest as it was", async () => {
            const before = await stored("noor")
            // 000101 as it was; 000102 paid further; 000103 not in the file; 000104 new.
            const next = [N1, { ...N2, paidAmount: 300.5, remainingAmount: 200 }, claim("000104", { item: "ضريبة كسب العمل", originalAmount: 75.75, paidAmount: 0, remainingAmount: 75.75 })]
            const saved = await tax.saveTaxFile(admin, upload("noor", 1, next), NOW)
            expect(saved).toEqual({ added: 1, changed: 1, gone: 1, claims: 3, uploads: 2, email: { state: "off" } })
            const after = await stored("noor")
            expect(after.map(c => [c.claimNumber, c.original, c.paid, c.remaining])).toEqual([["000101", 1000, 0, 1000], ["000102", 500.5, 300.5, 200], ["000104", 75.75, 0, 75.75]])
            // A claim that didn't change keeps its row.
            expect(after[0]).toEqual(before[0])
            expect(after[0].id).toBe("n1")
            expect((await logged("noor")).pop()?.details).toEqual({ name: "Al Noor", fileName: "claims - 2026-11-17.xlsx", asOf: "2026-11-17", added: 1, changed: 1, removed: 1, claims: 3 })
        })

        it("takes a file with no open claim: every claim goes, and the day stays, at 0", async () => {
            const saved = await tax.saveTaxFile(admin, upload("noor", 2, [], { asOf: "2026-11-15" }), NOW)
            expect(saved).toEqual({ added: 0, changed: 0, gone: 3, claims: 0, uploads: 3, email: { state: "off" } })
            expect(await stored("noor")).toEqual([])
            expect(await position("noor")).toMatchObject({ asOf: "2026-11-15", uploads: 3 })
            const got = await tax.taxPositionOf(admin, "noor", FIVE, NOW)
            expect([got.position?.asOf, got.totals.open, got.totals.remaining]).toEqual(["2026-11-15", 0, 0])
        })
    })

    describe("still as the check screen read them", () => {
        it("refuses a save whose claims were read before another file was saved, and changes nothing", async () => {
            await tax.saveTaxFile(admin, upload("delta", 0, [claim("000301")]), NOW)
            const before = await all("delta")
            await expect(tax.saveTaxFile(admin, upload("delta", 0, [claim("000302")]), NOW)).rejects.toThrow("TAX_CLAIMS_CHANGED")
            await expect(tax.saveTaxFile(admin, upload("delta", 5, [claim("000302")]), NOW)).rejects.toThrow("TAX_CLAIMS_CHANGED")
            expect(await all("delta")).toEqual(before)
        })

        it("saves one of two sent at once, and tells the other the claims changed", async () => {
            const results = await Promise.allSettled([
                tax.saveTaxFile(admin, upload("race", 0, [claim("000401")]), NOW),
                tax.saveTaxFile(admin, upload("race", 0, [claim("000402")]), NOW),
            ])
            expect(results.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"])
            expect((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason.message).toBe("TAX_CLAIMS_CHANGED")
            expect(await stored("race")).toHaveLength(1)
            expect(await position("race")).toMatchObject({ uploads: 1 })
            expect(await logged("race")).toHaveLength(1)
        })
    })

    describe("the right client", () => {
        const other = "شركة باء للتوريدات"

        it("refuses a file that names another company until it's sent as confirmed, then keeps its name", async () => {
            await expect(tax.saveTaxFile(admin, upload("named", 0, [claim("000501")], { fileCompany: other, confirmed: false }), NOW)).rejects.toThrow("TAX_FILE_OTHER_COMPANY")
            expect(await all("named")).toEqual([[], undefined, 0])
            await tax.saveTaxFile(admin, upload("named", 0, [claim("000501")], { fileCompany: other, confirmed: true }), NOW)
            expect(await position("named")).toMatchObject({ fileCompany: other, uploads: 1 })
            expect((await tax.taxClaimsNow(admin, "named", NOW)).fileCompany).toBe(other)
        })

        it("asks nothing where the file names the company the last one named, however it's spelled, or the client itself", async () => {
            await tax.saveTaxFile(admin, upload("named", 1, [claim("000501")], { fileCompany: "شركه باء  للتوريدات", confirmed: false }), NOW)
            await tax.saveTaxFile(admin, upload("named", 2, [claim("000501")], { fileCompany: "NAMED", confirmed: false }), NOW)
            // The name kept is the last file's, as the file wrote it.
            expect(await position("named")).toMatchObject({ fileCompany: "NAMED", uploads: 3 })
        })

        it("asks for a file that names no company, and leaves the name the last one named", async () => {
            for (const none of ["", "غير محدد"]) {
                await expect(tax.saveTaxFile(admin, upload("named", 3, [claim("000501")], { fileCompany: none, confirmed: false }), NOW)).rejects.toThrow("TAX_FILE_OTHER_COMPANY")
            }
            await tax.saveTaxFile(admin, upload("named", 3, [claim("000501")], { fileCompany: "غير محدد", confirmed: true }), NOW)
            expect(await position("named")).toMatchObject({ fileCompany: "NAMED", uploads: 4 })
        })
    })

    describe("the day the figures are from", () => {
        it("can't be after today where the company is", async () => {
            // The 18th hasn't come in Cairo; it has in Tokyo.
            await expect(tax.saveTaxFile(admin, upload("delta", 1, [claim("000301")], { asOf: "2026-11-18" }), NOW)).rejects.toThrow("TAX_DAY_AFTER_TODAY")
            await tax.saveTaxFile(otherAdmin, upload("theirs", 0, [claim("000601")], { asOf: "2026-11-18" }), NOW)
            expect(await position("theirs")).toMatchObject({ asOf: "2026-11-18", uploadedById: "a2", companyId: "c2" })
            await expect(tax.saveTaxFile(otherAdmin, upload("theirs", 1, [claim("000601")], { asOf: "2026-11-19" }), NOW)).rejects.toThrow("TAX_DAY_AFTER_TODAY")
        })
    })

    describe("the server checks again", () => {
        it("refuses the whole save for one claim that isn't right, and changes nothing", async () => {
            const before = await all("delta")
            const good = claim("000301")
            for (const wrong of [
                { ...claim("000302"), paidAmount: 10 },                             // doesn't add up
                { ...claim("000302"), originalAmount: -5, remainingAmount: -5 },
                { ...claim("000302"), originalAmount: 10.001, remainingAmount: 10.001 },
                { ...claim("000302"), dueDate: "2026-02-31" },
                { ...claim("000302"), claimNumber: " " },
                { ...claim("000302"), item: "" },
                { ...claim("000302"), claimNumber: 302 },                           // a number, which may have lost its zeros
                { ...claim("000302"), paidAmount: 1000, remainingAmount: 0 },        // nothing left to pay
                { ...claim("000302"), status: "مسدد" },
                { ...claim("000302"), claimNumber: "9".repeat(51) },
                claim("000301"),                                                    // its number twice
                claim("٠٠٠٣٠١"),
            ]) {
                await expect(tax.saveTaxFile(admin, upload("delta", 1, [good, wrong]), NOW), JSON.stringify(wrong)).rejects.toThrow("TAX_UPLOAD_INVALID")
            }
            for (const body of [null, "x", upload("delta", 1, [good], { asOf: "17/11/2026" }), upload("delta", 1, [good], { uploads: "1" }), upload("delta", 1, "none" as never)]) {
                await expect(tax.saveTaxFile(admin, body, NOW)).rejects.toThrow("TAX_UPLOAD_INVALID")
            }
            expect(await all("delta")).toEqual(before)
        })

        it("refuses more than 2,000 claims", async () => {
            const many = Array.from({ length: 2001 }, (_, i) => claim(String(i).padStart(6, "0")))
            await expect(tax.saveTaxFile(admin, upload("many", 0, many), NOW)).rejects.toThrow("TAX_TOO_MANY_CLAIMS")
            expect(await all("many")).toEqual([[], undefined, 0])
        })

        it("keeps a claim's number with Latin digits and its words tidied, whoever sent it", async () => {
            await tax.saveTaxFile(admin, upload("delta", 1, [claim(" ٠٠٠٣٠١ ", { item: "  إقرار   ضريبة\u0000 الدخل " })]), NOW)
            expect((await db.query(`SELECT "claimNumber", item FROM "TaxClaim" WHERE "clientId" = 'delta'`)).rows).toEqual([{ claimNumber: "000301", item: "إقرار ضريبة الدخل" }])
            // The same claim as before: nothing changed.
            expect((await logged("delta")).pop()?.details).toMatchObject({ added: 0, changed: 0, removed: 0, claims: 1 })
        })
    })

    describe("in one go", () => {
        it("saves 2,000 claims, and replaces them", async () => {
            const many = Array.from({ length: 2000 }, (_, i) => claim(String(i).padStart(6, "0")))
            expect(await tax.saveTaxFile(admin, upload("many", 0, many), NOW)).toEqual({ added: 2000, changed: 0, gone: 0, claims: 2000, uploads: 1, email: { state: "off" } })
            expect(await stored("many")).toHaveLength(2000)
            // The first as it was, the rest paid in part, and the last hundred not in the file.
            const next = many.slice(0, 1900).map((c, i) => (i === 0 ? c : { ...c, paidAmount: 1, remainingAmount: 999 }))
            expect(await tax.saveTaxFile(admin, upload("many", 1, next), NOW)).toEqual({ added: 0, changed: 1899, gone: 100, claims: 1900, uploads: 2, email: { state: "off" } })
            expect((await db.query(`SELECT count(*)::int AS n, sum("remainingAmount")::float8 AS remaining FROM "TaxClaim" WHERE "clientId" = 'many'`)).rows).toEqual([{ n: 1900, remaining: 1000 + 1899 * 999 }])
        }, 60_000)

        it("changes nothing where the database refuses a claim: not the claims that would go, the day or the log", async () => {
            // What the server's own checks let through, the claims' table takes, so a rule is added for the test.
            await db.query(`ALTER TABLE "TaxClaim" ADD CONSTRAINT "test_refuses" CHECK (item <> 'refused by the test')`)
            try {
                const before = await all("many")
                await expect(tax.saveTaxFile(admin, upload("many", 2, [claim("900001"), claim("900002", { item: "refused by the test" })]), NOW)).rejects.toThrow()
                expect(await all("many")).toEqual(before)
            } finally {
                await db.query(`ALTER TABLE "TaxClaim" DROP CONSTRAINT "test_refuses"`)
            }
        }, 60_000)
    })

    describe("who may save", () => {
        it("isn't a Team Leader, whose role hasn't the permission, nor another company's Admin", async () => {
            const before = await all("delta")
            await expect(tax.saveTaxFile(leader, upload("delta", 2, []), NOW)).rejects.toThrow("TAX_MANAGE_REQUIRED")
            await expect(tax.saveTaxFile(otherAdmin, upload("delta", 2, []), NOW)).rejects.toThrow("CLIENT_NOT_FOUND")
            await expect(tax.saveTaxFile(admin, upload("nobody", 0, []), NOW)).rejects.toThrow("CLIENT_NOT_FOUND")
            expect(await all("delta")).toEqual(before)
        })

        it("refuses an archived client's, and one archived while the check screen was open", async () => {
            await expect(tax.saveTaxFile(admin, upload("old", 1, []), NOW)).rejects.toThrow("CLIENT_ARCHIVED")
            expect(await stored("old")).toHaveLength(1)
            const read = await tax.taxClaimsNow(admin, "closing", NOW)
            await db.query(`UPDATE "Client" SET "archivedAt" = now() WHERE id = 'closing'`)
            await expect(tax.saveTaxFile(admin, upload("closing", read.uploads, [claim("000701")]), NOW)).rejects.toThrow("CLIENT_ARCHIVED")
            expect(await all("closing")).toEqual([[], undefined, 0])
        })

        it("is the Super Admin for any company's client: their name is kept, and the entry is theirs", async () => {
            const saved = await tax.saveTaxFile(superAdmin, upload("theirs", 1, [claim("000601"), claim("000602")]), NOW)
            expect(saved).toEqual({ added: 1, changed: 0, gone: 0, claims: 2, uploads: 2, email: { state: "off" } })
            expect(await position("theirs")).toMatchObject({ uploadedById: null, uploadedByName: "Nizmo", companyId: "c2" })
            expect((await stored("theirs")).map(c => c.companyId)).toEqual(["c2", "c2"])
            expect((await logged("theirs")).pop()).toMatchObject({ action: "UPDATE_TAX_POSITION", userId: null, superAdminId: "sa" })
        })
    })
})
