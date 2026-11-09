import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * What's held for a task follows it when it's transferred (CLIENTS_PLAN.md
 * §7.9, step 7h), against a real Postgres. Transfer task sends the original
 * for review and makes a copy for the new people: whoever's still on the
 * copy keeps their money, now for the copy; whoever's left off passes theirs
 * to someone on the copy, who confirms receiving it. Passing it needs
 * whoever may give and settle advances, with two-factor sign-in; without
 * that, it joins the left-off person's running balance.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ exists: async () => ({ data: true }), remove: async () => ({ data: [], error: null }) }) } }, uploadToCloud: async () => { throw new Error("no uploads here") } }))

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1', NULL),
 ('e3', 'e3@x', 'p', 'Essam', 'One', 'EMPLOYEE', 2026, 'e3', 'c1', NULL),
 ('e4', 'e4@x', 'p', 'Fady', 'One', 'EMPLOYEE', 2026, 'e4', 'c1', NULL),
 ('e5', 'e5@x', 'p', 'Hoda', 'One', 'EMPLOYEE', 2026, 'e5', 'c1', NULL),
 ('e6', 'e6@x', 'p', 'Ola', 'One', 'EMPLOYEE', 2026, 'e6', 'c1', NULL),
 ('x1', 'x1@x', 'p', 'Xena', 'Two', 'EMPLOYEE', 2026, 'x1', 'c2', NULL);
`
// Ehab and Eman are on the gate and the dock, Ehab alone on the roof, Eman
// alone on the shed, Fady on the mast, Fady and Hoda on the keel, Ehab and
// Eman on the pier, Ehab alone on the cove and the quay. Ola is archived
// before the cove is transferred to them; Xena is another company's.
const WORK = `
INSERT INTO "Location"(id, "companyId", "clientId", name, "isHq", latitude, longitude, "updatedAt") VALUES ('port', 'c1', NULL, 'Port gate', false, 31.18, 29.87, now());
INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "locationId", "updatedAt") VALUES
 ('gate', 'Fix the gate', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now()),
 ('roof', 'Patch the roof', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now()),
 ('dock', 'Sweep the dock', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now()),
 ('shed', 'Paint the shed', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now()),
 ('mast', 'Raise the mast', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now()),
 ('keel', 'Scrape the keel', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now()),
 ('pier', 'Mend the pier', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now()),
 ('cove', 'Dredge the cove', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now()),
 ('quay', 'Light the quay', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now());
INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('gate', 'e1'), ('gate', 'e2'), ('roof', 'e1'), ('dock', 'e1'), ('dock', 'e2'),
 ('shed', 'e2'), ('mast', 'e4'), ('keel', 'e4'), ('keel', 'e5'), ('pier', 'e1'), ('pier', 'e2'),
 ('cove', 'e1'), ('quay', 'e1');
`

const MINUTE = 60_000
type Who = Record<string, unknown>
const confirmed = (user: Who) => ({ user: { ...withGrants(user as any), mfaEnabled: true, stepUpAt: Date.now() } }) as any
const noCode = (user: Who) => ({ user: { ...withGrants(user as any), mfaEnabled: true, stepUpAt: Date.now() - 120 * MINUTE } }) as any
const AMAL = { id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }
const admin = confirmed(AMAL)
const ehab = noCode({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Ehab One" })
const eman = noCode({ id: "e2", role: "EMPLOYEE", companyId: "c1", name: "Eman One" })
const essam = noCode({ id: "e3", role: "EMPLOYEE", companyId: "c1", name: "Essam One" })
const sara = confirmed({ id: "sa1", role: "SUPER_ADMIN", name: "Sara Admin" })
const PAGE = { page: 1, limit: 50, skip: 0 }

describe.skipIf(!ADMIN_URL)("what's held for a task follows it when it's transferred, in Postgres", () => {
    const dbName = `advance_transfer_test_${Date.now()}`
    let db: Client
    let Advances: typeof import("@/lib/services/cash-advance.service").CashAdvanceService
    let Tasks: typeof import("@/lib/services/task.service").TaskService
    let prisma: typeof import("@/lib/prisma").prisma

    const give = (userId: string, amount: number, forTaskId: string) =>
        Advances.record(admin, userId, { kind: "GIVEN", amount, date: "2026-10-01", forTaskId })
    const outcome = (p: Promise<unknown>) => p.then(() => "done", (e: Error & { code?: string }) => e.code ?? e.message)
    const held = async (userId: string) => (await Advances.person(admin.user, userId, PAGE)).held.map(h => [h.forTask?.id, h.amount])
    const balance = async (userId: string) => (await Advances.person(admin.user, userId, PAGE)).balance
    const copyOf = async (taskId: string) => (await db.query(`SELECT id FROM "Task" WHERE title = (SELECT title FROM "Task" WHERE id = $1) || ' (Transfer Copy)'`, [taskId])).rows[0]?.id as string | undefined
    const entries = async (userId: string, kind: string) =>
        (await db.query(`SELECT amount::float, "forTaskId", "counterpartName", "confirmedAt" IS NOT NULL AS confirmed FROM "CashAdvanceEntry" WHERE "userId" = $1 AND kind::text = $2 ORDER BY "createdAt", amount`, [userId, kind])).rows

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
        await db.query(WORK)
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES ('sa1', 'sa1@x', 'p', 'Sara', 'Admin', 'sa1', now())`)
        await db.query(`UPDATE "Company" SET "cashAdvancesAllowed" = true WHERE id = 'c1'`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Advances = (await import("@/lib/services/cash-advance.service")).CashAdvanceService
        Tasks = (await import("@/lib/services/task.service")).TaskService
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

    it("keeps the money of whoever's still on the copy, now for the copy, with no rights and no code", async () => {
        await give("e1", 400, "gate")
        const awaiting = (await Advances.person(admin.user, "e1", PAGE)).awaiting
        // Ehab transfers their own task, staying on it and adding Essam.
        expect(await outcome(Tasks.transfer("gate", ehab, { newAssigneeIds: ["e1", "e3"] }))).toBe("done")
        const copy = (await copyOf("gate"))!
        expect(copy).toBeTruthy()
        expect(await held("e1")).toEqual([[copy, 400]])
        expect(await balance("e1")).toBe(400)
        // A pair, their own: nothing to confirm.
        expect(await entries("e1", "TRANSFERRED")).toEqual([
            { amount: -400, forTaskId: "gate", counterpartName: null, confirmed: false },
            { amount: 400, forTaskId: copy, counterpartName: null, confirmed: true },
        ])
        // Nothing more to confirm than the advance Ehab was given.
        expect((await Advances.person(admin.user, "e1", PAGE)).awaiting).toBe(awaiting)
    })

    it("passes what someone left off holds to the one person on the copy, who confirms it and can spend it meanwhile", async () => {
        await give("e1", 300, "roof")
        expect(await outcome(Tasks.transfer("roof", admin, { newAssigneeIds: ["e3"] }))).toBe("done")
        const copy = (await copyOf("roof"))!
        expect(await held("e1")).not.toContainEqual(["roof", 300])
        expect(await held("e3")).toEqual([[copy, 300]])
        expect(await entries("e1", "TRANSFERRED")).toContainEqual({ amount: -300, forTaskId: "roof", counterpartName: "Essam One", confirmed: false })
        const [taken] = await entries("e3", "TRANSFERRED")
        expect(taken).toEqual({ amount: 300, forTaskId: copy, counterpartName: "Ehab One", confirmed: false })
        expect((await Advances.person(admin.user, "e3", PAGE)).awaiting).toBe(300)

        // Spent before it's confirmed: a cost on the copy takes from it.
        await Tasks.submit(copy, "e3", essam, { isDraft: true, costs: [{ amount: 100, description: "Tar for the roof" }] })
        expect(await held("e3")).toEqual([[copy, 200]])

        const entryId = (await db.query(`SELECT id FROM "CashAdvanceEntry" WHERE "userId" = 'e3' AND kind::text = 'TRANSFERRED' AND amount > 0`)).rows[0].id
        expect(await outcome(Advances.confirm(essam, entryId))).toBe("done")
        expect((await Advances.person(admin.user, "e3", PAGE)).awaiting).toBe(0)
        // Once.
        expect(await outcome(Advances.confirm(essam, entryId))).toBe("CASH_ADVANCE_ALREADY_CONFIRMED")
    })

    it("asks who takes it where the copy has more than one, and only someone on the copy", async () => {
        await give("e2", 200, "dock")
        expect(await outcome(Tasks.transfer("dock", admin, { newAssigneeIds: ["e1", "e3"] }))).toBe("TRANSFER_HELD_RECEIVER_REQUIRED")
        expect(await outcome(Tasks.transfer("dock", admin, { newAssigneeIds: ["e1", "e3"], heldGoesTo: "e4" }))).toBe("TRANSFER_HELD_RECEIVER_INVALID")
        // Refused, nothing changed: no copy, and Eman still holds it.
        expect(await copyOf("dock")).toBeUndefined()
        expect(await held("e2")).toContainEqual(["dock", 200])

        expect(await outcome(Tasks.transfer("dock", admin, { newAssigneeIds: ["e1", "e3"], heldGoesTo: "e3" }))).toBe("done")
        const copy = (await copyOf("dock"))!
        expect(await held("e2")).not.toContainEqual(["dock", 200])
        expect(await held("e3")).toContainEqual([copy, 200])
    })

    it("moves it to their own running balance where whoever transfers it may not give advances", async () => {
        await give("e2", 150, "shed")
        const before = await balance("e2")
        // Eman transfers their own task to Essam: they may, but may not give advances.
        expect(await outcome(Tasks.transfer("shed", eman, { newAssigneeIds: ["e3"] }))).toBe("done")
        expect(await held("e2")).not.toContainEqual(["shed", 150])
        expect(await balance("e2")).toBe(before)
        expect(await entries("e2", "MOVED")).toEqual([
            { amount: -150, forTaskId: "shed", counterpartName: null, confirmed: false },
            { amount: 150, forTaskId: null, counterpartName: null, confirmed: false },
        ])
        const copy = (await copyOf("shed"))!
        expect(await held("e3")).not.toContainEqual([copy, 150])
        const logged = (await db.query(`SELECT details->>'because' AS because FROM "AuditLog" WHERE action::text = 'MOVE_CASH_ADVANCE' AND details->>'forTaskId' = 'shed'`)).rows
        expect(logged).toEqual([{ because: "TAKEN_OFF" }])
    })

    it("asks for two-factor sign-in to pass it, unless the company turned the confirmation off", async () => {
        await give("e4", 100, "mast")
        expect(await outcome(Tasks.transfer("mast", noCode(AMAL), { newAssigneeIds: ["e5"] }))).toBe("STEP_UP_REQUIRED")
        expect(await copyOf("mast")).toBeUndefined()
        expect(await held("e4")).toContainEqual(["mast", 100])

        await db.query(`UPDATE "Company" SET "confirmHighRisk" = false WHERE id = 'c1'`)
        try {
            expect(await outcome(Tasks.transfer("mast", noCode(AMAL), { newAssigneeIds: ["e5"] }))).toBe("done")
        } finally {
            await db.query(`UPDATE "Company" SET "confirmHighRisk" = true WHERE id = 'c1'`)
        }
        expect(await held("e5")).toContainEqual([(await copyOf("mast"))!, 100])
    })

    it("moves nothing on a transfer that adds no one, as it makes no copy", async () => {
        await give("e4", 50, "keel")
        expect(await outcome(Tasks.transfer("keel", admin, { newAssigneeIds: ["e5"] }))).toBe("done")
        expect(await copyOf("keel")).toBeUndefined()
        expect(await held("e4")).toContainEqual(["keel", 50])
    })

    it("says before it's sent what will happen, with the amounts only for whoever sees them", async () => {
        await give("e1", 100, "pier")
        await give("e2", 50, "pier")
        const before = await held("e1")
        // Eman stays on and Essam joins: Ehab's passes, to whoever's picked.
        expect(await Tasks.transferPreview("pier", admin, ["e2", "e3"], null)).toEqual({
            copy: true,
            held: true,
            moves: [
                { person: { id: "e1", name: "Ehab One" }, what: "PASSED", to: null, amount: 100 },
                { person: { id: "e2", name: "Eman One" }, what: "KEPT", to: null, amount: 50 },
            ],
            pickReceiver: true,
        })
        expect((await Tasks.transferPreview("pier", admin, ["e2", "e3"], "e3")).moves[0]).toEqual(
            { person: { id: "e1", name: "Ehab One" }, what: "PASSED", to: { id: "e3", name: "Essam One" }, amount: 100 })
        // Eman, transferring it themselves, may not give advances: Ehab's joins Ehab's own
        // running balance, and Eman sees only their own amount.
        expect(await Tasks.transferPreview("pier", eman, ["e2", "e3"], null)).toEqual({
            copy: true,
            held: true,
            moves: [
                { person: { id: "e1", name: "Ehab One" }, what: "RUNNING", to: null, amount: null },
                { person: { id: "e2", name: "Eman One" }, what: "KEPT", to: null, amount: 50 },
            ],
            pickReceiver: false,
        })
        // Adding no one: no copy, nothing moves, and what's held stays with the task.
        expect(await Tasks.transferPreview("pier", admin, ["e2"], null)).toEqual({ copy: false, held: true, moves: [], pickReceiver: false })
        // Nothing's held for the roof any more, passed on above: nothing to say.
        expect(await Tasks.transferPreview("roof", admin, ["e5"], null)).toEqual({ copy: true, held: false, moves: [], pickReceiver: false })
        // Someone of another company, picked, isn't named, and nothing passes to them.
        expect((await Tasks.transferPreview("pier", admin, ["e2", "x1"], "x1")).moves[0]).toEqual(
            { person: { id: "e1", name: "Ehab One" }, what: "RUNNING", to: null, amount: 100 })
        // Someone not on the task, and not one who may transfer it, is refused.
        expect(await outcome(Tasks.transferPreview("pier", essam, ["e3"], null))).toBe("UNAUTHORIZED_TRANSFER")
        // Only said: nothing moved.
        expect(await held("e1")).toEqual(before)
    })

    // Codex on PR 241: money was passed to someone no longer at work, or in
    // another company, where the company couldn't settle it.
    it("passes nothing to someone no longer at work, or another company's: it joins the running balance", async () => {
        await db.query(`UPDATE "User" SET status = 'ARCHIVED' WHERE id = 'e6'`)
        await give("e1", 60, "cove")
        expect((await Tasks.transferPreview("cove", admin, ["e6"], null)).moves).toEqual([
            { person: { id: "e1", name: "Ehab One" }, what: "RUNNING", to: null, amount: 60 },
        ])
        expect(await outcome(Tasks.transfer("cove", admin, { newAssigneeIds: ["e6"] }))).toBe("done")
        expect(await held("e1")).not.toContainEqual(["cove", 60])
        expect(await entries("e6", "TRANSFERRED")).toEqual([])
        expect((await entries("e1", "MOVED")).filter(e => e.forTaskId === "cove")).toEqual([{ amount: -60, forTaskId: "cove", counterpartName: null, confirmed: false }])

        // A Super Admin may transfer a task to another company's person: nothing passes to them.
        await give("e1", 80, "quay")
        expect(await outcome(Tasks.transfer("quay", sara, { newAssigneeIds: ["x1"] }))).toBe("done")
        expect(await held("e1")).not.toContainEqual(["quay", 80])
        expect((await db.query(`SELECT count(*)::int AS n FROM "CashAdvanceEntry" WHERE "userId" = 'x1'`)).rows[0].n).toBe(0)
    })

    it("logs each, saying how much, from which task to which, and from whom to whom", async () => {
        const rows = (await db.query(`SELECT "userId", details FROM "AuditLog" WHERE action::text = 'TRANSFER_CASH_ADVANCE' ORDER BY "createdAt"`)).rows
        const gate = rows.find(r => r.details.fromTaskId === "gate")!
        expect(gate.details).toMatchObject({ amount: 400, fromUserId: "e1", toUserId: "e1" })
        expect(gate.userId).toBe("e1")
        const roof = rows.find(r => r.details.fromTaskId === "roof")!
        expect(roof.details).toMatchObject({ amount: 300, fromUserId: "e1", toUserId: "e3", toTaskId: await copyOf("roof") })
        expect(roof.userId).toBe("a1")
    })
})
