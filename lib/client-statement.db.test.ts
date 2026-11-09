import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"
import { calendarDateStr } from "@/lib/time"

/**
 * A client statement (CLIENTS_PLAN.md §6.9; DESIGN.md §5.5, Client
 * statement), against a real Postgres: which charges it lists, in the
 * company's own days, what's still due from before the period, each charge
 * as it is the day it's issued, and who may have one. A client's charges
 * were on screen only; there was no statement to give the client.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: null, uploadToCloud: async () => { throw new Error("no uploads here") } }))

const RECEIPTS = "https://p.supabase.co/storage/v1/object/public/app-assets/c1/receipts"
// Al Noor Trading's October, as the mock-up has it, with one charge from
// September still due and one collected in October; one left off its bill;
// Delta Foods' charges on either side of October's edges in Cairo, where
// the clocks go back on 29 October; Big's 201 errands; a task with no
// client; and another company's.
const DATA = `
INSERT INTO "Company"(id, name, timezone, "logoUrl", "updatedAt") VALUES
 ('c1', 'Nile Works', 'Africa/Cairo', 'https://p.supabase.co/storage/v1/object/public/app-assets/c1/logo.png', now()),
 ('c2', 'Two', 'Africa/Cairo', NULL, now());
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES
 ('noor', 'c1', 'Al Noor Trading', 'Hassan Adel', '0100', 'Cairo', now()),
 ('delta', 'c1', 'Delta Foods', 'Dina', '0101', 'Giza', now()),
 ('big', 'c1', 'Big Client', 'Basma', '0103', 'Cairo', now()),
 ('theirs', 'c2', 'Their client', 'Tarek', '0102', 'Alex', now());
INSERT INTO "Location"(id, "companyId", "clientId", name, "isHq", latitude, longitude, "updatedAt") VALUES
 ('port', 'c1', NULL, 'Port gate', false, 31.18, 29.87, now()),
 ('dock', 'c2', NULL, 'Dock', false, 31.2, 29.9, now());
INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "clientId", "locationId", "updatedAt") VALUES
 ('k1', 'AC repair, 2nd floor', 'd', 'APPROVED', now(), 'c1', 'noor', 'port', now()),
 ('k2', 'Network cabling', 'd', 'APPROVED', now(), 'c1', 'noor', 'port', now()),
 ('k3', 'Repaint the reception', 'd', 'IN_PROGRESS', now(), 'c1', 'noor', 'port', now()),
 ('k5', 'Fix the gate', 'd', 'APPROVED', now(), 'c1', 'delta', 'port', now()),
 ('k6', 'Errands', 'd', 'APPROVED', now(), 'c1', 'big', 'port', now()),
 ('k7', 'Staff lunch', 'd', 'APPROVED', now(), 'c1', NULL, 'port', now()),
 ('k9', 'Their task', 'd', 'APPROVED', now(), 'c2', 'theirs', 'dock', now());
INSERT INTO "TaskCost"(id, "taskId", "authorName", amount, "serviceFee", description, "receiptUrl", "notCharged", "collectedAt", "createdAt") VALUES
 ('x0', 'k1', 'Ehab', 600, 0, 'Water pump seal', NULL, false, NULL, '2026-09-24T09:00:00Z'),
 ('xg', 'k1', 'Ehab', 500, 50, 'Glass panel', NULL, false, '2026-10-20T10:00:00Z', '2026-09-28T09:00:00Z'),
 ('x1', 'k1', 'Ehab', 1850, 150, 'Spare parts', '${RECEIPTS}/r1.jpg', false, '2026-10-20T10:00:00Z', '2026-10-02T09:00:00Z'),
 ('x2', 'k2', 'Karim', 240, 20, 'Cable ties and tape', '${RECEIPTS}/r2.png', false, '2026-10-20T10:00:00Z', '2026-10-05T09:00:00Z'),
 ('x3', 'k2', 'Karim', 120, 0, 'Taxi', NULL, false, '2026-10-20T10:00:00Z', '2026-10-09T09:00:00Z'),
 ('x4', 'k3', 'Mona', 1300, 100, 'Paint', '${RECEIPTS}/r4.pdf', false, NULL, '2026-10-14T09:00:00Z'),
 ('x5', 'k3', 'Mona', 350, 50, 'Door handle', '${RECEIPTS}/r5.webp', false, NULL, '2026-10-21T09:00:00Z'),
 ('x6', 'k3', 'Mona', 540, 60, 'LED bulbs', '${RECEIPTS}/r6.jpg', false, NULL, '2026-10-28T09:00:00Z'),
 ('xn', 'k1', 'Ehab', 999, 0, 'Lunch for the crew', NULL, true, NULL, '2026-10-15T09:00:00Z'),
 ('xl', 'k7', 'Ehab', 75, 0, 'Lunch', NULL, false, NULL, '2026-10-10T09:00:00Z'),
 ('d1', 'k5', 'Eman', 10, 0, 'First hour of October', NULL, false, NULL, '2026-09-30T21:30:00Z'),
 ('d2', 'k5', 'Eman', 20, 0, 'Last hour of September', NULL, false, NULL, '2026-09-30T20:30:00Z'),
 ('d3', 'k5', 'Eman', 30, 0, 'Last hour of October', NULL, false, NULL, '2026-10-31T21:30:00Z'),
 ('d4', 'k5', 'Eman', 40, 0, 'First hour of November', NULL, false, NULL, '2026-10-31T22:30:00Z'),
 ('t9', 'k9', 'Someone', 99, 0, 'Theirs', NULL, false, NULL, '2026-10-12T09:00:00Z');
INSERT INTO "TaskCost"(id, "taskId", "authorName", amount, description, "createdAt")
 SELECT 'b' || n, 'k6', 'Basma', 1, 'Errand ' || n, '2026-10-01T09:00:00Z'::timestamp + (n || ' minutes')::interval FROM generate_series(1, 201) n;
-- Named Co's October, by cost name: one picked from the saved list since
-- renamed, and typed to match it; one typed to match a saved name no charge
-- picked; Taxi typed three ways, which another company's list and the task
-- titles' list have; and one with no name.
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES
 ('named', 'c1', 'Named Co', 'Nadia', '0104', 'Cairo', now());
INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "clientId", "locationId", "updatedAt") VALUES
 ('k8', 'Fit the kitchen', 'd', 'APPROVED', now(), 'c1', 'named', 'port', now());
INSERT INTO "ListEntry"(id, "companyId", kind, name, "archivedAt", "updatedAt") VALUES
 ('le1', 'c1', 'COST_NAME', 'Genuine spare parts', NULL, now()),
 ('le2', 'c1', 'COST_NAME', 'Petrol', '2026-10-01T00:00:00Z', now()),
 ('le3', 'c2', 'COST_NAME', 'TAXI', NULL, now()),
 ('le4', 'c1', 'TASK_TITLE', 'TAXI', NULL, now());
INSERT INTO "TaskCost"(id, "taskId", "authorName", amount, "serviceFee", description, "nameEntryId", "createdAt") VALUES
 ('m1', 'k8', 'Ehab', 100, 10, 'Spare parts', 'le1', '2026-10-03T09:00:00Z'),
 ('m2', 'k8', 'Ehab', 50, 0, 'genuine spare  PARTS', NULL, '2026-10-04T09:00:00Z'),
 ('m3', 'k8', 'Ehab', 30, 0, 'petrol', NULL, '2026-10-05T09:00:00Z'),
 ('m4', 'k8', 'Ehab', 20, 0, 'Taxi', NULL, '2026-10-06T09:00:00Z'),
 ('m5', 'k8', 'Ehab', 25, 0, 'taxi', NULL, '2026-10-07T09:00:00Z'),
 ('m6', 'k8', 'Ehab', 15, 0, 'Taxi', NULL, '2026-10-08T09:00:00Z'),
 ('m7', 'k8', 'Ehab', 5, 0, NULL, NULL, '2026-10-09T09:00:00Z');
`

const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" })
const leader = withGrants({ id: "t1", role: "TEAM_LEADER", companyId: "c1", name: "Tamer One" })
const employee = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Ehab One" })
const otherAdmin = withGrants({ id: "a2", role: "ADMIN", companyId: "c2", name: "Adel Two" })
const superAdmin = { id: "sa", role: "SUPER_ADMIN", companyId: null, name: "Sara Admin" }
const OCTOBER = { from: "2026-10-01", to: "2026-10-31" }

describe.skipIf(!ADMIN_URL)("a client statement, in Postgres", () => {
    const dbName = `statement_test_${Date.now()}`
    let db: Client
    let statements: typeof import("@/lib/services/client-statement.service")
    let lastMonth: typeof import("@/lib/client-statement").lastMonth
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
        for (const m of MIGRATIONS) await db.query(sql(m))
        await db.query(DATA)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        statements = await import("@/lib/services/client-statement.service")
        lastMonth = (await import("@/lib/client-statement")).lastMonth
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

    const statement = (user: unknown, input: Record<string, unknown>) => statements.clientStatement(user as never, input as never)

    it("lists the period's charges, oldest first, none left off the bill, and adds them up", async () => {
        const s = await statement(admin, { clientId: "noor", ...OCTOBER })
        expect(s.charges.map(c => c.id)).toEqual(["x1", "x2", "x3", "x4", "x5", "x6"])
        expect(s.charges.map(c => c.day)).toEqual(["2026-10-02", "2026-10-05", "2026-10-09", "2026-10-14", "2026-10-21", "2026-10-28"])
        expect(s.charges[0]).toEqual({
            id: "x1", day: "2026-10-02", description: "Spare parts", task: { id: "k1", title: "AC repair, 2nd floor" },
            paid: 1850, fee: 150, total: 2000, collectedOn: "2026-10-20", receipt: { number: 1, url: `${RECEIPTS}/r1.jpg`, pdf: false },
        })
        expect(s.charges.map(c => c.receipt?.number ?? null)).toEqual([1, 2, null, 3, 4, 5])
        expect(s.charges[3].receipt).toEqual({ number: 3, url: `${RECEIPTS}/r4.pdf`, pdf: true })
        expect(s.charges.map(c => c.collectedOn)).toEqual(["2026-10-20", "2026-10-20", "2026-10-20", null, null, null])
        // September's water pump seal is still due; its glass panel was collected in October.
        expect(s.totals).toEqual({ paid: 4400, fees: 380, charged: 4780, collected: 2380, due: 2400, dueCount: 3, dueBefore: 600, dueBeforeCount: 1, stillDue: 3000 })
        expect(s.company).toEqual({ name: "Nile Works", logoUrl: "https://p.supabase.co/storage/v1/object/public/app-assets/c1/logo.png" })
        expect(s.client).toEqual({ id: "noor", name: "Al Noor Trading", ownerName: "Hassan Adel" })
        expect(s.period).toEqual(OCTOBER)
        expect(s.issuedOn).toBe(calendarDateStr(new Date(), "Africa/Cairo"))
    })

    it("adds up the charges by cost name: the saved list's name as it is now, typed ones matching it or each other, and No name", async () => {
        const s = await statement(admin, { clientId: "named", ...OCTOBER })
        expect(s.charges.map(c => c.id)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6", "m7"])
        expect(s.names).toEqual([
            { key: "genuine spare parts", name: "Genuine spare parts", ids: ["m1", "m2"], paid: 150, fee: 10, total: 160 },
            // Typed as Taxi twice, taxi once: neither company's other lists name it.
            { key: "taxi", name: "Taxi", ids: ["m4", "m5", "m6"], paid: 60, fee: 0, total: 60 },
            // Archived, a saved name is still its name.
            { key: "petrol", name: "Petrol", ids: ["m3"], paid: 30, fee: 0, total: 30 },
            { key: "", name: null, ids: ["m7"], paid: 5, fee: 0, total: 5 },
        ])
        // Every charge's statement is the same, its charges as they were.
        expect(s.charges[0]).toMatchObject({ id: "m1", description: "Spare parts" })
        expect(s.charges[0]).not.toHaveProperty("entryName")
        expect(s.totals.charged).toBe(255)
    })

    it("counts its days where the company is, the period's first and last whole", async () => {
        const s = await statement(admin, { clientId: "delta", ...OCTOBER })
        // 00:30 on 1 October and 23:30 on 31 October in Cairo are October's;
        // 23:30 on 30 September is from before, and 00:30 on 1 November neither.
        expect(s.charges.map(c => c.id)).toEqual(["d1", "d3"])
        expect(s.charges.map(c => c.day)).toEqual(["2026-10-01", "2026-10-31"])
        expect(s.totals).toMatchObject({ charged: 40, due: 40, dueCount: 2, dueBefore: 20, dueBeforeCount: 1, stillDue: 60 })
    })

    it("is last month where the company is, without both of the period's days", async () => {
        const expected = lastMonth(calendarDateStr(new Date(), "Africa/Cairo"))
        expect((await statement(admin, { clientId: "noor" })).period).toEqual(expected)
        expect((await statement(admin, { clientId: "noor", from: "2026-10-01" })).period).toEqual(expected)
        expect((await statement(admin, { clientId: "noor", from: "2026-10-31", to: "2026-10-01" })).period).toEqual(OCTOBER)
    })

    it("shows each charge as it is the day it's issued", async () => {
        await prisma.taskCost.update({ where: { id: "x4" }, data: { collectedAt: new Date("2026-11-03T08:00:00Z") } })
        try {
            const s = await statement(admin, { clientId: "noor", ...OCTOBER })
            expect(s.charges[3].collectedOn).toBe("2026-11-03")
            expect(s.totals).toMatchObject({ collected: 3780, due: 1000, dueCount: 2, stillDue: 1600 })
        } finally {
            await prisma.taskCost.update({ where: { id: "x4" }, data: { collectedAt: null } })
        }
    })

    it("is for whoever sees all the company's charges: a Team Leader sees their team's only", async () => {
        await expect(statement(leader, { clientId: "noor", ...OCTOBER })).rejects.toThrow("STATEMENT_COMPANY_WIDE")
        await expect(statement(employee, { clientId: "noor", ...OCTOBER })).rejects.toThrow("STATEMENT_COMPANY_WIDE")
    })

    it("isn't another company's to see, but a Super Admin sees any client's", async () => {
        await expect(statement(otherAdmin, { clientId: "noor", ...OCTOBER })).rejects.toThrow("CLIENT_NOT_FOUND")
        await expect(statement(admin, { clientId: "theirs", ...OCTOBER })).rejects.toThrow("CLIENT_NOT_FOUND")
        await expect(statement(admin, { clientId: "nobody", ...OCTOBER })).rejects.toThrow("CLIENT_NOT_FOUND")
        await expect(statement(admin, { ...OCTOBER })).rejects.toThrow("STATEMENT_CLIENT_REQUIRED")
        const theirs = await statement(superAdmin, { clientId: "theirs", ...OCTOBER })
        expect(theirs.charges.map(c => c.id)).toEqual(["t9"])
        expect(theirs.company.name).toBe("Two")
        expect((await statement(superAdmin, { clientId: "noor", ...OCTOBER })).totals.stillDue).toBe(3000)
    })

    it("holds 200 charges at most, and asks for a shorter period past that", async () => {
        await expect(statement(admin, { clientId: "big", ...OCTOBER })).rejects.toThrow("STATEMENT_TOO_MANY")
        await prisma.taskCost.delete({ where: { id: "b201" } })
        const s = await statement(admin, { clientId: "big", ...OCTOBER })
        expect(s.charges).toHaveLength(200)
        expect(s.totals.charged).toBe(200)
    })
})
