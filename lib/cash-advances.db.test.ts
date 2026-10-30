import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"

/**
 * Cash advances (CLIENTS_PLAN.md §7, step 7a), against a real Postgres: the
 * ledger and what it holds to, giving, returning and correcting, confirming
 * receipt, who sees whose, the switches, and two at once.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({
    supabase: { storage: { from: () => ({ exists: async (path: string) => ({ data: !path.includes("gone") }), remove: async () => ({ data: [], error: null }) }) } },
    uploadToCloud: async () => { throw new Error("no uploads here") },
}))

// One uses cash advances; Two isn't allowed them. Sara is suspended.
const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId", status) VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL, 'ACTIVE'),
 ('t1', 't1@x', 'p', 'Tamer', 'One', 'TEAM_LEADER', 2026, 't1', 'c1', NULL, 'OFFLINE'),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', 't1', 'OFFLINE'),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1', NULL, 'OFFLINE'),
 ('s1', 's1@x', 'p', 'Sara', 'One', 'EMPLOYEE', 2026, 's1', 'c1', NULL, 'SUSPENDED'),
 ('a2', 'a2@x', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL, 'ACTIVE'),
 ('e9', 'e9@x', 'p', 'Ezz', 'Two', 'EMPLOYEE', 2026, 'e9', 'c2', NULL, 'OFFLINE');
`

/**
 * Before 7c's migration (CLIENTS_PLAN.md §7.8): a company's own role, and
 * Two's built-in Team Leader, whom an Admin gave See cash advances for the
 * whole company in the role editor already.
 */
const BEFORE_GRANTED = `
INSERT INTO "Role"(id, "companyId", name, "baseRole", version, "updatedAt") VALUES ('own-desk', 'c1', 'Front desk', 'EMPLOYEE', 3, now());
INSERT INTO "RoleGrant"("roleId", permission, scope) VALUES ('own-desk', 'tasks.view', 'TEAM');
INSERT INTO "RoleGrant"("roleId", permission, scope) SELECT id, 'cash_advances.view', 'COMPANY' FROM "Role" WHERE "companyId" = 'c2' AND "builtIn" = 'TEAM_LEADER';
`
const CASH_ADVANCES_GRANTED = "20261122000000_cash_advances_granted"

const as = (user: Record<string, unknown>) => ({ user: { ...withGrants(user as any), mfaEnabled: true, stepUpAt: Date.now() } }) as any
const admin = as({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" })
const leader = as({ id: "t1", role: "TEAM_LEADER", companyId: "c1", name: "Tamer One" })
const ehab = as({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Ehab One" })
const eman = as({ id: "e2", role: "EMPLOYEE", companyId: "c1", name: "Eman One" })
const otherAdmin = as({ id: "a2", role: "ADMIN", companyId: "c2", name: "Adel Two" })
const superAdmin = as({ id: "sa", role: "SUPER_ADMIN", companyId: null, name: "Sam Admin" })
const PAGE = { page: 1, limit: 20, skip: 0 }
const photo = (path: string) => `https://files.test/storage/v1/object/public/app-assets/${path}`

describe.skipIf(!ADMIN_URL)("cash advances, in Postgres", () => {
    const dbName = `cash_advances_test_${Date.now()}`
    let db: Client
    let dbUrl: string
    let Advances: typeof import("@/lib/services/cash-advance.service").CashAdvanceService
    let Companies: typeof import("@/lib/services/company.service").CompanyService
    let prisma: typeof import("@/lib/prisma").prisma
    let rolesBefore: { id: string; companyId: string; builtIn: string | null; version: number }[] = []
    // As 7c's migration left them.
    let versionsAfter: Record<string, number> = {}
    const today = new Date().toISOString().slice(0, 10)
    const give = (session: any, userId: string, amount: unknown, more: Record<string, unknown> = {}) =>
        Advances.record(session, userId, { kind: "GIVEN", amount, date: "2026-10-01", ...more })
    const balance = async (userId: string) => (await Advances.person(admin.user, userId, PAGE)).balance

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`CREATE DATABASE ${dbName}`)
        await a.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        dbUrl = url.toString()
        db = new Client({ connectionString: dbUrl })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
            if (m === "20261121000000_advance_spending") {
                await db.query(BEFORE_GRANTED)
                rolesBefore = (await db.query(`SELECT id, "companyId", "builtIn", version FROM "Role" ORDER BY id`)).rows
            }
            if (m === CASH_ADVANCES_GRANTED) versionsAfter = Object.fromEntries((await db.query(`SELECT id, version FROM "Role"`)).rows.map(r => [r.id, r.version]))
        }
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES ('sa', 'sa@x', 'p', 'Sam', 'Admin', 'sam', now())`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Advances = (await import("@/lib/services/cash-advance.service")).CashAdvanceService
        Companies = (await import("@/lib/services/company.service")).CompanyService
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

    describe("a company that doesn't use them", () => {
        it("answers nothing until the Super Admin allows them, or while its Admin has them off", async () => {
            await expect(Advances.list(admin.user, {}, PAGE)).rejects.toThrow("CASH_ADVANCES_OFF")
            await expect(give(admin, "e1", 100)).rejects.toThrow("CASH_ADVANCES_OFF")
            await Companies.update({ id: "c1", cashAdvancesAllowed: true }, superAdmin)
            await Companies.update({ id: "c1", cashAdvancesOn: false }, admin)
            await expect(Advances.person(ehab.user, "e1", PAGE)).rejects.toThrow("CASH_ADVANCES_OFF")
            await Companies.update({ id: "c1", cashAdvancesOn: true }, admin)
            expect((await Advances.list(admin.user, {}, PAGE)).total).toBeGreaterThan(0)
            await expect(Advances.list(otherAdmin.user, {}, PAGE)).rejects.toThrow("CASH_ADVANCES_OFF")
        })
    })

    describe("the ledger", () => {
        it("gives an advance, with two-factor sign-in, and the balance is the entries' sum", async () => {
            await expect(give({ user: { ...admin.user, stepUpAt: null } }, "e1", 1000)).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" })
            const given = await give(admin, "e1", "1000", { note: "For the gate", photoUrl: photo("c1/cash-advances/handover.jpg") })
            expect(given).toMatchObject({ balance: 1000, entry: { kind: "GIVEN", amount: 1000, date: "2026-10-01", note: "For the gate", recordedByName: "Amal One", confirmedAt: null } })
            const audit = await db.query(`SELECT action, "entityType", "entityId", "userId", details FROM "AuditLog" WHERE action = 'GIVE_CASH_ADVANCE'`)
            expect(audit.rows).toEqual([{ action: "GIVE_CASH_ADVANCE", entityType: "USER", entityId: "e1", userId: "a1", details: expect.objectContaining({ amount: 1000, balance: 1000 }) }])
            const ehabsOwn = await Advances.person(ehab.user, "e1", PAGE)
            expect(ehabsOwn).toMatchObject({ balance: 1000, awaiting: 1000, total: 1, canGive: false, person: { name: "Ehab One", atWork: true } })
        })

        it("records a return up to what's held, and a correction that keeps it above zero, with why", async () => {
            await expect(Advances.record(admin, "e1", { kind: "RETURNED", amount: 1000.01, date: "2026-10-02" })).rejects.toThrow("CASH_ADVANCE_MORE_THAN_HELD")
            expect((await Advances.record(admin, "e1", { kind: "RETURNED", amount: 300, date: "2026-10-02", note: "Change" })).balance).toBe(700)
            await expect(Advances.record(admin, "e1", { kind: "CORRECTION", amount: -800, date: "2026-10-03", note: "Typo" })).rejects.toThrow("CASH_ADVANCE_BELOW_ZERO")
            await expect(Advances.record(admin, "e1", { kind: "CORRECTION", amount: 50, date: "2026-10-03" })).rejects.toThrow("CASH_ADVANCE_REASON_REQUIRED")
            expect((await Advances.record(admin, "e1", { kind: "CORRECTION", amount: 50.25, date: "2026-10-03", note: "Counted again" })).balance).toBe(750.25)
            const entries = (await Advances.person(admin.user, "e1", PAGE)).data
            expect(entries.map(e => [e.kind, e.amount])).toEqual([["CORRECTION", 50.25], ["RETURNED", -300], ["GIVEN", 1000]])
        })

        it("refuses amounts, days, notes and photos that can't be one", async () => {
            for (const amount of [0, -5, "", "abc", 1_000_000.01, null]) await expect(give(admin, "e2", amount)).rejects.toThrow("CASH_ADVANCE_AMOUNT_INVALID")
            await expect(Advances.record(admin, "e2", { kind: "CORRECTION", amount: 0, date: "2026-10-01", note: "x" })).rejects.toThrow("CASH_ADVANCE_AMOUNT_INVALID")
            await expect(Advances.record(admin, "e2", { kind: "SPENT", amount: 10, date: "2026-10-01" })).rejects.toThrow("CASH_ADVANCE_KIND_INVALID")
            for (const date of ["2026-02-30", "30/10/2026", "", "2999-01-01"]) await expect(give(admin, "e2", 10, { date })).rejects.toThrow("CASH_ADVANCE_DATE_INVALID")
            await expect(give(admin, "e2", 10, { note: "x".repeat(501) })).rejects.toThrow("CASH_ADVANCE_NOTE_TOO_LONG")
            // Another folder's, another company's, one no longer stored, one already on an advance, and one on a return.
            for (const url of [photo("c1/receipts/r.jpg"), photo("c2/cash-advances/h.jpg"), photo("c1/cash-advances/gone.jpg"), photo("c1/cash-advances/handover.jpg"), "https://elsewhere.test/h.jpg"]) {
                await expect(give(admin, "e2", 10, { photoUrl: url })).rejects.toThrow("CASH_ADVANCE_PHOTO_INVALID")
            }
            await expect(Advances.record(admin, "e1", { kind: "RETURNED", amount: 1, date: "2026-10-01", photoUrl: photo("c1/cash-advances/r2.jpg") })).rejects.toThrow("CASH_ADVANCE_PHOTO_INVALID")
            expect(await give(admin, "e2", 10, { date: today })).toMatchObject({ balance: 10 })
        })

        it("gives only to someone at work, never to oneself, and only with Give and settle cash advances, in one's company", async () => {
            await expect(give(admin, "s1", 100)).rejects.toThrow("CASH_ADVANCE_NOT_AT_WORK")
            await expect(give(admin, "a1", 100)).rejects.toThrow("CASH_ADVANCE_NOT_FOUND")
            await expect(Advances.record(admin, "a1", { kind: "CORRECTION", amount: 5, date: "2026-10-01", note: "Mine" })).rejects.toThrow("CASH_ADVANCE_NOT_FOUND")
            await expect(give(leader, "e1", 100)).rejects.toThrow("CASH_ADVANCE_NOT_FOUND")
            await expect(give(otherAdmin, "e1", 100)).rejects.toThrow("CASH_ADVANCE_NOT_FOUND")
            await expect(give(admin, "e9", 100)).rejects.toThrow("CASH_ADVANCE_NOT_FOUND")
            // The Super Admin may for anyone, and their name is kept.
            expect(await give(superAdmin, "a1", 25)).toMatchObject({ balance: 25, entry: { recordedByName: "Sam Admin" } })
        })

        it("holds to the kinds' signs and to what's confirmed, in the database too", async () => {
            const insert = (kind: string, amount: number, extra = "NULL, NULL") =>
                db.query(`INSERT INTO "CashAdvanceEntry"(id, "companyId", "userId", kind, amount, date, "confirmedAt", "photoUrl", "recordedById") VALUES (gen_random_uuid()::text, 'c1', 'e2', '${kind}', ${amount}, '2026-10-01', ${extra}, 'a1')`)
            await expect(insert("GIVEN", -1)).rejects.toThrow(/CashAdvanceEntry_amount_check/)
            await expect(insert("RETURNED", 1)).rejects.toThrow(/CashAdvanceEntry_amount_check/)
            await expect(insert("CORRECTION", 0)).rejects.toThrow(/CashAdvanceEntry_amount_check/)
            await expect(insert("RETURNED", -1, "now(), NULL")).rejects.toThrow(/CashAdvanceEntry_given_check/)
            await expect(insert("CORRECTION", 1, "NULL, 'https://x/y.jpg'")).rejects.toThrow(/CashAdvanceEntry_given_check/)
        })

        it("takes two returns at once one after the other, so together they never take more than is held", async () => {
            const before = await balance("e1")
            const results = await Promise.allSettled([0, 1].map(() => Advances.record(admin, "e1", { kind: "RETURNED", amount: 500, date: "2026-10-04" })))
            expect(results.map(r => r.status).sort()).toEqual(["fulfilled", "rejected"])
            expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.message).toBe("CASH_ADVANCE_MORE_THAN_HELD")
            expect(await balance("e1")).toBe(before - 500)
        })
    })

    describe("confirming receipt", () => {
        it("is the employee's own, once for each advance", async () => {
            const [given] = (await Advances.person(ehab.user, "e1", { page: 1, limit: 100, skip: 0 })).data.filter(e => e.kind === "GIVEN")
            await expect(Advances.confirm(eman, given.id)).rejects.toThrow("CASH_ADVANCE_NOT_FOUND")
            await expect(Advances.confirm(admin, given.id)).rejects.toThrow("CASH_ADVANCE_NOT_FOUND")
            const [returned] = (await Advances.person(ehab.user, "e1", PAGE)).data.filter(e => e.kind === "RETURNED")
            await expect(Advances.confirm(ehab, returned.id)).rejects.toThrow("CASH_ADVANCE_NOT_FOUND")
            expect((await Advances.confirm(ehab, given.id)).confirmedAt).toBeInstanceOf(Date)
            await expect(Advances.confirm(ehab, given.id)).rejects.toThrow("CASH_ADVANCE_ALREADY_CONFIRMED")
            expect((await Advances.person(ehab.user, "e1", PAGE)).awaiting).toBe(0)
            expect((await db.query(`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'CONFIRM_CASH_ADVANCE' AND "entityId" = 'e1'`)).rows[0].n).toBe(1)
        })
    })

    describe("who sees whose", () => {
        it("lists everyone at work in the company, and anyone else holding money, with what they all hold", async () => {
            const list = await Advances.list(admin.user, {}, PAGE)
            expect(list.data.map(p => p.id)).toEqual(["a1", "e1", "e2", "t1"])
            expect(list.totals).toEqual({ held: 25 + 250.25 + 10, awaiting: 25 + 10, holders: 3 })
            expect(list.data.find(p => p.id === "e1")).toMatchObject({ balance: 250.25, awaiting: 0, lastDate: "2026-10-04", atWork: true })
            // Suspended while holding money, still listed, and still settled.
            await db.query(`UPDATE "User" SET status = 'SUSPENDED' WHERE id = 'e2'`)
            expect((await Advances.list(admin.user, {}, PAGE)).data.find(p => p.id === "e2")).toMatchObject({ atWork: false, balance: 10 })
            expect((await Advances.record(admin, "e2", { kind: "RETURNED", amount: 10, date: "2026-10-05" })).balance).toBe(0)
            expect((await Advances.list(admin.user, {}, PAGE)).data.map(p => p.id)).not.toContain("e2")
            await db.query(`UPDATE "User" SET status = 'OFFLINE' WHERE id = 'e2'`)
        })

        it("searches by name, and filters to those holding an advance", async () => {
            expect((await Advances.list(admin.user, { search: "ehab one" }, PAGE)).data.map(p => p.id)).toEqual(["e1"])
            expect((await Advances.list(admin.user, { holding: true }, PAGE)).data.map(p => p.id)).toEqual(["a1", "e1"])
            const paged = await Advances.list(admin.user, {}, { page: 2, limit: 3, skip: 3 })
            expect(paged).toMatchObject({ total: 4, totalPages: 2, data: [{ id: "t1" }] })
        })

        it("shows a Team Leader their team and themselves, and an employee only their own", async () => {
            expect((await Advances.list(leader.user, {}, PAGE)).data.map(p => p.id)).toEqual(["e1", "t1"])
            expect((await Advances.person(leader.user, "e1", PAGE)).canGive).toBe(false)
            await expect(Advances.person(leader.user, "e2", PAGE)).rejects.toThrow("CASH_ADVANCE_NOT_FOUND")
            await expect(Advances.list(ehab.user, {}, PAGE)).rejects.toThrow("CASH_ADVANCE_NOT_FOUND")
            await expect(Advances.person(eman.user, "e1", PAGE)).rejects.toThrow("CASH_ADVANCE_NOT_FOUND")
            await expect(Advances.person(otherAdmin.user, "e1", PAGE)).rejects.toThrow("CASH_ADVANCE_NOT_FOUND")
            expect((await Advances.person(admin.user, "e1", PAGE)).canGive).toBe(true)
            expect((await Advances.person(admin.user, "a1", PAGE)).canGive).toBe(false)
        })

        it("asks a Super Admin to pick a company first", async () => {
            await expect(Advances.list(superAdmin.user, {}, PAGE)).rejects.toThrow("CASH_ADVANCE_COMPANY_REQUIRED")
            expect((await Advances.list(superAdmin.user, { companyId: "c1" }, PAGE)).totals.holders).toBe(2)
        })
    })

    describe("the switches", () => {
        it("can't go off while anyone holds advance money, by the Admin or the Super Admin", async () => {
            await expect(Companies.update({ id: "c1", cashAdvancesOn: false }, admin)).rejects.toThrow("CASH_ADVANCES_HELD")
            await expect(Companies.update({ id: "c1", cashAdvancesAllowed: false }, superAdmin)).rejects.toThrow("CASH_ADVANCES_HELD")
            expect(await Advances.heldIn("c1")).toBe(275.25)
            await Advances.record(admin, "e1", { kind: "RETURNED", amount: 250.25, date: "2026-10-06" })
            await Advances.record(superAdmin, "a1", { kind: "RETURNED", amount: 25, date: "2026-10-06" })
            await Companies.update({ id: "c1", cashAdvancesOn: false }, admin)
            const { rows } = await db.query(`SELECT "cashAdvancesAllowed", "cashAdvancesOn" FROM "Company" WHERE id = 'c1'`)
            expect(rows).toEqual([{ cashAdvancesAllowed: true, cashAdvancesOn: false }])
            const audit = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'UPDATE_COMPANY' AND "entityId" = 'c1' ORDER BY "createdAt" DESC LIMIT 1`)
            expect(audit.rows[0].details).toEqual({ cashAdvancesOn: { old: true, new: false } })
            await Companies.update({ id: "c1", cashAdvancesOn: true }, admin)
        })

        it("an advance given as they go off waits for them, and is refused", async () => {
            const hold = new Client({ connectionString: dbUrl })
            await hold.connect()
            await hold.query("BEGIN")
            await hold.query(`SELECT id FROM "Company" WHERE id = 'c1' FOR UPDATE`)
            await hold.query(`UPDATE "Company" SET "cashAdvancesOn" = false WHERE id = 'c1'`)
            const given = give(admin, "e1", 100).then(() => "given", (e: Error) => e.message)
            await new Promise(r => setTimeout(r, 300))
            await hold.query("COMMIT")
            await hold.end()
            expect(await given).toBe("CASH_ADVANCES_OFF")
            expect(await Advances.heldIn("c1")).toBe(0)
            await Companies.update({ id: "c1", cashAdvancesOn: true }, admin)
        })
    })

    describe("the day an entry is on", () => {
        it("opens on today where the company is, and takes no later one", async () => {
            // A day apart at any moment, so whichever the test runs at, one is a day the other hasn't reached.
            const dayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date())
            const ahead = dayIn("Pacific/Kiritimati"), behind = dayIn("Pacific/Pago_Pago")
            const zone = (timeZone: string) => db.query(`UPDATE "Company" SET timezone = '${timeZone}' WHERE id = 'c1'`)
            try {
                await zone("Pacific/Pago_Pago")
                expect((await Advances.list(admin.user, {}, PAGE)).today).toBe(behind)
                expect((await Advances.person(ehab.user, "e1", PAGE)).today).toBe(behind)
                await expect(give(admin, "e1", 1, { date: ahead })).rejects.toThrow("CASH_ADVANCE_DATE_INVALID")
                await zone("Pacific/Kiritimati")
                expect((await Advances.list(admin.user, {}, PAGE)).today).toBe(ahead)
                expect(await give(admin, "e1", 1, { date: ahead })).toMatchObject({ balance: 1 })
                await Advances.record(admin, "e1", { kind: "RETURNED", amount: 1, date: ahead })
            } finally {
                await zone("Africa/Cairo")
            }
        })
    })

    describe("someone deleted for good", () => {
        it("isn't, while they still hold advance money; then their advance goes with them", async () => {
            const Users = (await import("@/lib/services/user.service")).UserService
            await give(admin, "e2", 50)
            await db.query(`UPDATE "User" SET status = 'DELETED' WHERE id = 'e2'`)
            await expect(Users.delete("e2", superAdmin, true)).rejects.toThrow("CASH_ADVANCE_STILL_HELD")
            await Advances.record(admin, "e2", { kind: "RETURNED", amount: 50, date: "2026-10-07" })
            await Users.delete("e2", superAdmin, true)
            expect((await db.query(`SELECT count(*)::int AS n FROM "CashAdvanceEntry" WHERE "userId" = 'e2'`)).rows[0].n).toBe(0)
        })

        it("isn't, either, while a correction for them is being recorded: it waits for it, and sees it", async () => {
            const Users = (await import("@/lib/services/user.service")).UserService
            await db.query(`UPDATE "User" SET status = 'DELETED' WHERE id = 's1'`)
            // A correction being recorded, as CashAdvanceService.record holds it, not yet committed.
            const recording = new Client({ connectionString: dbUrl })
            await recording.connect()
            await recording.query("BEGIN")
            await recording.query(`SELECT pg_advisory_xact_lock(hashtextextended('cash-advance:s1', 0))::text`)
            await recording.query(`INSERT INTO "CashAdvanceEntry"(id, "companyId", "userId", kind, amount, date, "recordedById") VALUES ('late', 'c1', 's1', 'CORRECTION', 75, '2026-10-08', 'a1')`)
            const deleted = Users.delete("s1", superAdmin, true).then(() => "deleted", (e: Error) => e.message)
            await new Promise(r => setTimeout(r, 300))
            await recording.query("COMMIT")
            await recording.end()
            expect(await deleted).toBe("CASH_ADVANCE_STILL_HELD")
            expect((await db.query(`SELECT count(*)::int AS n FROM "CashAdvanceEntry" WHERE id = 'late'`)).rows[0].n).toBe(1)
        })

        it("and a correction recorded as they're deleted waits, then finds nobody", async () => {
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", status, "roleId") SELECT 'g1', 'g1@x', 'p', 'Gone', 'One', 'EMPLOYEE', 2026, 'g1', 'c1', 'DELETED', id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)
            // Deleted for good, as UserService.delete holds it, not yet committed.
            const deleting = new Client({ connectionString: dbUrl })
            await deleting.connect()
            await deleting.query("BEGIN")
            await deleting.query(`SELECT pg_advisory_xact_lock(hashtextextended('cash-advance:g1', 0))::text`)
            await deleting.query(`DELETE FROM "User" WHERE id = 'g1'`)
            const corrected = Advances.record(admin, "g1", { kind: "CORRECTION", amount: 20, date: "2026-10-08", note: "Found in the drawer" }).then(() => "recorded", (e: Error) => e.message)
            await new Promise(r => setTimeout(r, 300))
            await deleting.query("COMMIT")
            await deleting.end()
            expect(await corrected).toBe("CASH_ADVANCE_NOT_FOUND")
        })
    })

    describe("the companies already there (7c)", () => {
        const advanceGrants = async () => (await db.query(`
            SELECT r.id, r."companyId", r."builtIn", g.permission, g.scope FROM "Role" r JOIN "RoleGrant" g ON g."roleId" = r.id
            WHERE g.permission LIKE 'cash\\_advances.%' ORDER BY r."companyId", r.id, g.permission`)).rows
        const versions = async () => Object.fromEntries((await db.query(`SELECT id, version FROM "Role"`)).rows.map(r => [r.id, r.version]))
        const givenOne = (r: { companyId: string; builtIn: string | null }) =>
            r.builtIn === "ADMIN" || (r.builtIn === "TEAM_LEADER" && r.companyId !== "c2")

        it("gives the built-in Admin and Team Leader roles the cash advances' permissions a new company's have", async () => {
            const rows = await advanceGrants()
            for (const company of ["c1", "c2"]) {
                for (const builtIn of ["ADMIN", "TEAM_LEADER", "EMPLOYEE"] as const) {
                    const given = Object.fromEntries(rows.filter(r => r.companyId === company && r.builtIn === builtIn).map(r => [r.permission, r.scope]))
                    const theirs = Object.fromEntries(Object.entries(BUILT_IN_GRANTS[builtIn]).filter(([permission]) => permission.startsWith("cash_advances.")))
                    // Two's Team Leader was given See cash advances for the company in the role editor, and keeps it.
                    expect(given, `${company} ${builtIn}`).toEqual(company === "c2" && builtIn === "TEAM_LEADER" ? { "cash_advances.view": "COMPANY" } : theirs)
                }
            }
            // A company's own roles are given them in the role editor.
            expect(rows.filter(r => r.builtIn === null)).toEqual([])
        })

        it("has the holders of a role given one reload their grants, and only them", async () => {
            expect(rolesBefore.length).toBe(7)
            for (const role of rolesBefore) expect(versionsAfter[role.id], `${role.companyId} ${role.builtIn ?? role.id}`).toBe(givenOne(role) ? role.version + 1 : role.version)
        })

        it("changes nothing run again", async () => {
            const [grants, before] = [await advanceGrants(), await versions()]
            await db.query(sql(CASH_ADVANCES_GRANTED))
            expect(await advanceGrants()).toEqual(grants)
            expect(await versions()).toEqual(before)
        })
    })
})
