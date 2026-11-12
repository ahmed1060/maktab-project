import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"

/**
 * Live updates' database side, against a real Postgres (REALTIME_PLAN.md):
 * the triggers that send a signal when a company's tasks change or a person
 * has a notification, and the rules on Supabase's realtime.messages that let
 * only the right people hear each channel.
 *
 * Postgres here has no Supabase, so the part of it the migration uses is
 * stood in for first, as Supabase has it: realtime.send(), which here only
 * writes down what it was asked to send; realtime.topic() and auth.jwt(),
 * read from the settings Realtime sets before it checks a listener; the
 * messages table, with row level security on; and the authenticated role.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const SUPABASE = `
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA realtime;
CREATE SCHEMA auth;
CREATE TABLE realtime.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), topic text NOT NULL, extension text NOT NULL, payload jsonb, event text, private boolean DEFAULT true);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA realtime, auth TO authenticated;
GRANT SELECT, INSERT ON realtime.messages TO authenticated;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('realtime.topic', true), '') $f$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$
    SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$f$;
CREATE TABLE realtime.sent (n bigserial, topic text, event text, payload jsonb, private boolean);
CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    IF current_setting('test.fail_send', true) = 'on' THEN RAISE EXCEPTION 'Realtime is down'; END IF;
    INSERT INTO realtime.sent(topic, event, payload, private) VALUES (topic, event, payload, private);
END
$f$;
`

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('u1', 'u1@x', 'p', 'Hana', 'One', 'ADMIN', 2026, 'u1', 'c1', NULL),
 ('u2', 'u2@x', 'p', 'Youssef', 'One', 'EMPLOYEE', 2026, 'u2', 'c1', NULL),
 ('u3', 'u3@x', 'p', 'Basma', 'Two', 'EMPLOYEE', 2026, 'u3', 'c2', NULL);
`
const SUPER = `INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES ('sa1', 'sa1@x', 'p', 'Sara', 'Admin', 'sa1', now());`

const task = (id: string, company: string | null) =>
    `('${id}', 'Task ${id}', 'd', 'IN_PROGRESS', now() + interval '3 days', ${company ? `'${company}'` : "NULL"}, now())`
const TASK_COLUMNS = `"Task"(id, title, description, status, deadline, "companyId", "updatedAt")`

describe.skipIf(!ADMIN_URL)("live updates, in Postgres", () => {
    const dbName = `live_updates_test_${Date.now()}`
    let db: Client

    /** What was sent since the last look, oldest first. */
    const sent = async () => (await db.query(`DELETE FROM realtime.sent RETURNING topic, event, payload, private, n`)).rows
        .sort((a, b) => Number(a.n) - Number(b.n))
        .map(({ topic, event, payload, private: priv }) => ({ topic, event, payload, private: priv }))
    const topics = async () => (await sent()).map(s => s.topic)

    /** Whether someone with these claims may listen to a topic, as Realtime asks it. */
    const hears = async (claims: Record<string, unknown> | null, topic: string, extension = "broadcast") => {
        await db.query("BEGIN")
        try {
            await db.query(`INSERT INTO realtime.messages(topic, extension, payload, event) VALUES ($1, $2, '{}', 'changed')`, [topic, extension])
            await db.query("SET LOCAL ROLE authenticated")
            await db.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('realtime.topic', $2, true)`, [claims ? JSON.stringify(claims) : "", topic])
            const { rows } = await db.query(`SELECT count(*)::int AS n FROM realtime.messages WHERE topic = $1`, [topic])
            return rows[0].n > 0
        } finally {
            await db.query("ROLLBACK")
        }
    }
    const HANA = { sub: "u1", role: "authenticated", company_id: "c1", super_admin: false }
    const SARA = { sub: "sa1", role: "authenticated", company_id: null, super_admin: true }

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`CREATE DATABASE ${dbName}`)
        await a.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        await db.query(SUPABASE)
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(SUPER)
    }, 120_000)

    afterAll(async () => {
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await a.end()
    })

    beforeEach(async () => { await sent() })

    describe("a company's tasks", () => {
        it("are signalled once per change, for each company it touched, saying nothing of what", async () => {
            await db.query(`INSERT INTO ${TASK_COLUMNS} VALUES ${task("t1", "c1")}, ${task("t2", "c1")}, ${task("t3", "c1")}, ${task("t4", "c2")}`)
            expect(await sent()).toEqual([
                { topic: "tasks:c1", event: "changed", payload: {}, private: true },
                { topic: "tasks:c2", event: "changed", payload: {}, private: true },
            ])
        })

        it("when one changes or goes", async () => {
            await db.query(`UPDATE "Task" SET status = 'PENDING_CONFIRMATION' WHERE id = 't1'`)
            expect(await topics()).toEqual(["tasks:c1"])
            await db.query(`DELETE FROM "Task" WHERE id = 't3'`)
            expect(await topics()).toEqual(["tasks:c1"])
        })

        it("when someone is put on one, or taken off it", async () => {
            await db.query(`INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('t1', 'u2'), ('t4', 'u3')`)
            expect((await topics()).sort()).toEqual(["tasks:c1", "tasks:c2"])
            await db.query(`DELETE FROM "_MultipleAssignees" WHERE "A" = 't1' AND "B" = 'u2'`)
            expect(await topics()).toEqual(["tasks:c1"])
        })

        it("both before and after, when a task moves from one company to another", async () => {
            await db.query(`UPDATE "Task" SET "companyId" = 'c2' WHERE id = 't2'`)
            expect((await topics()).sort()).toEqual(["tasks:c1", "tasks:c2"])
        })

        it("not at all for a change that touched nothing, or a task of no company", async () => {
            await db.query(`UPDATE "Task" SET status = 'IN_PROGRESS' WHERE id = 'nobody'`)
            await db.query(`INSERT INTO ${TASK_COLUMNS} VALUES ${task("t9", null)}`)
            expect(await topics()).toEqual([])
        })
    })

    describe("a notification", () => {
        it("is signalled to the person or Super Admin it's for, once each, saying nothing of what", async () => {
            await db.query(`INSERT INTO "Notification"(id, "userId", type, message) VALUES ('n1', 'u2', 'TASK_ASSIGNED', 'x'), ('n2', 'u2', 'TASK_ASSIGNED', 'y'), ('n3', 'u1', 'TASK_ASSIGNED', 'z')`)
            await db.query(`INSERT INTO "Notification"(id, "superAdminId", type, message) VALUES ('n4', 'sa1', 'X', 'w')`)
            expect(await sent()).toEqual([
                { topic: "notices:u1", event: "changed", payload: {}, private: true },
                { topic: "notices:u2", event: "changed", payload: {}, private: true },
                { topic: "notices:sa1", event: "changed", payload: {}, private: true },
            ])
        })

        it("and when it's read, so every tab of theirs agrees", async () => {
            await db.query(`UPDATE "Notification" SET read = true WHERE "userId" = 'u2'`)
            expect(await topics()).toEqual(["notices:u2"])
        })
    })

    // Part 3: the screen of someone who can't go on asks the heartbeat at
    // once, which signs it out, rather than at the next beat, 90 seconds on.
    describe("an account that can't go on", () => {
        const account = (topic: string) => ({ topic, event: "account", payload: {}, private: true })

        it("is signalled to the person, when they're suspended, closed or deleted", async () => {
            for (const status of ["SUSPENDED", "ARCHIVED", "DELETED"]) {
                await db.query(`UPDATE "User" SET status = 'ACTIVE' WHERE id = 'u2'`)
                await sent()
                await db.query(`UPDATE "User" SET status = $1::"UserStatus" WHERE id = 'u2'`, [status])
                expect(await sent(), status).toEqual([account("notices:u2")])
            }
        })

        it("to each of several at once, once each", async () => {
            await db.query(`UPDATE "User" SET status = 'ACTIVE' WHERE id IN ('u1', 'u2')`)
            await sent()
            await db.query(`UPDATE "User" SET status = 'SUSPENDED' WHERE id IN ('u1', 'u2')`)
            expect((await topics()).sort()).toEqual(["notices:u1", "notices:u2"])
            await db.query(`UPDATE "User" SET status = 'ACTIVE' WHERE id IN ('u1', 'u2')`)
            await sent()
        })

        it("but not for signing in or out, being let back in, or the heartbeat's beat", async () => {
            await db.query(`UPDATE "User" SET status = 'OFFLINE' WHERE id = 'u2'`)
            await db.query(`UPDATE "User" SET status = 'ACTIVE', "lastActivity" = now() WHERE id = 'u2'`)
            await db.query(`UPDATE "User" SET "lastActivity" = now() WHERE id = 'u2'`)
            await db.query(`UPDATE "User" SET status = 'SUSPENDED' WHERE id = 'u2'`)
            await sent()
            await db.query(`UPDATE "User" SET status = 'ACTIVE' WHERE id = 'u2'`)
            // The same status again, as an edit that sends it unchanged does.
            await db.query(`UPDATE "User" SET status = 'ACTIVE' WHERE id = 'u2'`)
            expect(await sent()).toEqual([])
        })

        it("is signalled to the whole company when it's banned, and not when it's let back", async () => {
            await db.query(`UPDATE "Company" SET "isBanned" = true WHERE id = 'c1'`)
            expect(await sent()).toEqual([account("tasks:c1")])
            await db.query(`UPDATE "Company" SET "isBanned" = false WHERE id = 'c1'`)
            await db.query(`UPDATE "Company" SET name = 'One again' WHERE id = 'c1'`)
            expect(await sent()).toEqual([])
        })

        it("and heard only by those it's for", async () => {
            expect(await hears({ sub: "u2", role: "authenticated", company_id: "c1", super_admin: false }, "notices:u2")).toBe(true)
            expect(await hears(HANA, "notices:u2")).toBe(false)
            expect(await hears({ sub: "u3", role: "authenticated", company_id: "c2", super_admin: false }, "tasks:c1")).toBe(false)
        })

        it("never stopping the change it's for when it can't be sent", async () => {
            await db.query("SET test.fail_send = 'on'")
            try {
                await db.query(`UPDATE "User" SET status = 'SUSPENDED' WHERE id = 'u2'`)
                await db.query(`UPDATE "Company" SET "isBanned" = true WHERE id = 'c2'`)
            } finally {
                await db.query("RESET test.fail_send")
            }
            expect((await db.query(`SELECT status FROM "User" WHERE id = 'u2'`)).rows[0].status).toBe("SUSPENDED")
            expect((await db.query(`SELECT "isBanned" FROM "Company" WHERE id = 'c2'`)).rows[0].isBanned).toBe(true)
            expect(await sent()).toEqual([])
            await db.query(`UPDATE "User" SET status = 'ACTIVE' WHERE id = 'u2'`)
            await db.query(`UPDATE "Company" SET "isBanned" = false WHERE id = 'c2'`)
        })
    })

    // Part 2: the Requests page and the count on Requests in the side bar,
    // drawn again as a request is asked for, decided or withdrawn
    // (prisma/migrations/20261210000000_live_requests).
    describe("a company's requests", () => {
        const requests = (topic: string) => ({ topic, event: "requests", payload: {}, private: true })
        /** What reaches the requests' channels: not part 4c's attendance channel, which the same rows signal. */
        const requestsSent = async () => (await sent()).filter(s => !s.topic.startsWith("attendance:") && s.event !== "attendance")
        /** What one statement in a company sends: to its people, and to each Super Admin. */
        const toCompany = (company: string) => [requests(`tasks:${company}`), requests("notices:sa1")]

        beforeAll(async () => {
            await db.query(`INSERT INTO "Role"(id, "companyId", name, "baseRole", "updatedAt") VALUES ('r-live', 'c1', 'Live', 'EMPLOYEE', now())`)
            await sent()
        })

        // Each kind that carries its company, asked for, changed and withdrawn.
        const KINDS: [string, string, string, string][] = [
            ["internal requests", `INSERT INTO "Request"(id, title, details, "userId", "companyId", "updatedAt") VALUES ('rq1', 'Chairs', 'Two', 'u2', 'c1', now())`, `"Request"`, `status = 'IN_PROGRESS'`],
            ["permission hours", `INSERT INTO "PermissionRequest"(id, "companyId", "userId", date, type, "startMinutes", "endMinutes", minutes, reason) VALUES ('pr1', 'c1', 'u2', '2026-11-10', 'EARLY_LEAVE', 900, 960, 60, 'Dentist')`, `"PermissionRequest"`, `status = 'APPROVED'`],
            ["missing punches", `INSERT INTO "MissingPunchRequest"(id, "companyId", "userId", date, "claimedAt", reason) VALUES ('mp1', 'c1', 'u2', '2026-11-10', '2026-11-10 09:00', 'Forgot')`, `"MissingPunchRequest"`, `status = 'REJECTED'`],
            ["overtime decisions", `INSERT INTO "OvertimeApproval"(id, "companyId", "userId", date, status, "approvedMinutes", "decidedById") VALUES ('oa1', 'c1', 'u2', '2026-11-10', 'APPROVED', 60, 'u1')`, `"OvertimeApproval"`, `note = 'An hour'`],
            ["role requests", `INSERT INTO "RoleRequest"(id, "companyId", "userId", "roleId", "requestedById", "updatedAt") VALUES ('rr1', 'c1', 'u2', 'r-live', 'u1', now())`, `"RoleRequest"`, `"decisionNote" = 'Yes'`],
        ]
        for (const [name, insert, table, change] of KINDS) {
            it(`${name}: asked for, changed and withdrawn, to the company and each Super Admin`, async () => {
                await db.query(insert)
                expect(await requestsSent(), "asked for").toEqual(toCompany("c1"))
                await db.query(`UPDATE ${table} SET ${change}`)
                expect(await requestsSent(), "changed").toEqual(toCompany("c1"))
                await db.query(`DELETE FROM ${table}`)
                expect(await requestsSent(), "withdrawn").toEqual(toCompany("c1"))
            })
        }

        it("day off and name changes, which carry only their person, to the person's company", async () => {
            await db.query(`INSERT INTO "DayOffRequest"(id, "userId", type, date, "updatedAt") VALUES ('do1', 'u3', 'REGULAR', '2026-11-12', now())`)
            expect(await requestsSent()).toEqual(toCompany("c2"))
            await db.query(`UPDATE "DayOffRequest" SET status = 'APPROVED' WHERE id = 'do1'`)
            expect(await requestsSent()).toEqual(toCompany("c2"))
            await db.query(`DELETE FROM "DayOffRequest" WHERE id = 'do1'`)
            expect(await requestsSent()).toEqual(toCompany("c2"))
            await db.query(`INSERT INTO "ProfileUpdateRequest"(id, "userId", "oldFirstName", "oldLastName", "newFirstName", "newLastName", "updatedAt") VALUES ('pu1', 'u2', 'Youssef', 'One', 'Yusuf', 'One', now())`)
            expect(await requestsSent()).toEqual(toCompany("c1"))
            await db.query(`UPDATE "ProfileUpdateRequest" SET status = 'REJECTED' WHERE id = 'pu1'`)
            expect(await requestsSent()).toEqual(toCompany("c1"))
            await db.query(`DELETE FROM "ProfileUpdateRequest" WHERE id = 'pu1'`)
            expect(await requestsSent()).toEqual(toCompany("c1"))
        })

        it("once for each company a statement touched, and once for each Super Admin", async () => {
            await db.query(`INSERT INTO "Request"(id, title, details, "userId", "companyId", "updatedAt") VALUES
                ('rq2', 'A', 'a', 'u2', 'c1', now()), ('rq3', 'B', 'b', 'u1', 'c1', now()), ('rq4', 'C', 'c', 'u3', 'c2', now())`)
            expect(await requestsSent()).toEqual([requests("tasks:c1"), requests("tasks:c2"), requests("notices:sa1")])
            await db.query(`UPDATE "Request" SET status = 'DONE' WHERE id IN ('rq2', 'rq3')`)
            expect(await requestsSent()).toEqual(toCompany("c1"))
            // Nothing changed, nothing to tell.
            await db.query(`UPDATE "Request" SET status = 'DONE' WHERE id = 'nobody'`)
            expect(await requestsSent()).toEqual([])
            await db.query(`DELETE FROM "Request"`)
            await sent()
        })

        it("overtime: a day's waiting, worked out again or decided, and not every day worked out", async () => {
            const day = (set: string) => db.query(`UPDATE "AttendanceDay" SET ${set} WHERE id = 'ad1'`)
            await db.query(`INSERT INTO "AttendanceDay"(id, "companyId", "userId", date, status, breakdown, "inputsHash") VALUES ('ad1', 'c1', 'u2', '2026-11-10', 'PRESENT', '{}', 'h1')`)
            await day(`"inputsHash" = 'h2', "lastOutAt" = '2026-11-10 17:00'`)
            expect(await requestsSent(), "a day without overtime, worked out").toEqual([])
            await day(`"overtimeStatus" = 'PENDING', "overtimeMinutes" = 60`)
            expect(await requestsSent(), "its overtime waits").toEqual(toCompany("c1"))
            await day(`"overtimeMinutes" = 75, "lastOutAt" = '2026-11-10 18:15'`)
            expect(await requestsSent(), "and is worked out again").toEqual(toCompany("c1"))
            await day(`"inputsHash" = 'h3'`)
            expect(await requestsSent(), "nothing the row shows").toEqual([])
            await day(`"overtimeStatus" = 'APPROVED'`)
            expect(await requestsSent(), "decided").toEqual(toCompany("c1"))
            await day(`"overtimeMinutes" = 90`)
            expect(await requestsSent(), "worked out again once decided").toEqual([])
            await db.query(`DELETE FROM "AttendanceDay" WHERE id = 'ad1'`)
            expect(await requestsSent(), "a decided day gone").toEqual([])
        })

        it("flagged check-ins: flagged, reviewed or withdrawn, and not every check-in", async () => {
            const punch = (id: string, status: string) => db.query(
                `INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone", status)
                 VALUES ($1, 'c1', 'u2', 'MOBILE', $1, '2026-11-10 09:00', '2026-11-10 07:00', 'Africa/Cairo', $2::"PunchStatus")`, [id, status])
            await punch("ap1", "ACCEPTED")
            const withdraw = (id: string) => db.query(`UPDATE "AttendancePunch" SET "voidedAt" = now(), "voidedById" = 'u1', "voidReason" = 'Wrong' WHERE id = $1`, [id])
            await withdraw("ap1")
            expect(await requestsSent(), "a check-in, and one withdrawn").toEqual([])
            await punch("ap2", "FLAGGED")
            expect(await requestsSent(), "flagged").toEqual(toCompany("c1"))
            await db.query(`UPDATE "AttendancePunch" SET status = 'ACCEPTED', "reviewedAt" = now() WHERE id = 'ap2'`)
            expect(await requestsSent(), "reviewed").toEqual(toCompany("c1"))
            await withdraw("ap2")
            expect(await requestsSent(), "a reviewed one withdrawn").toEqual(toCompany("c1"))
            await db.query(`DELETE FROM "AttendancePunch" WHERE id = 'ap1'`)
            expect(await requestsSent(), "a check-in gone").toEqual([])
        })

        it("check-in phones: asked for and decided, and not used", async () => {
            await db.query(`INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform) VALUES ('ph1', 'c1', 'u2', 'k', 'f1', 'IOS')`)
            expect(await requestsSent(), "asked for").toEqual(toCompany("c1"))
            await db.query(`UPDATE "CheckInPhone" SET "appAttestCounter" = "appAttestCounter" + 1, "pushToken" = 'tok', "pushTokenAt" = now() WHERE id = 'ph1'`)
            expect(await requestsSent(), "used").toEqual([])
            await db.query(`UPDATE "CheckInPhone" SET status = 'ACTIVE', "decidedAt" = now() WHERE id = 'ph1'`)
            expect(await requestsSent(), "decided").toEqual(toCompany("c1"))
            await db.query(`DELETE FROM "CheckInPhone" WHERE id = 'ph1'`)
            expect(await requestsSent(), "gone").toEqual(toCompany("c1"))
        })

        it("heard by the company's people and each Super Admin, and by nobody else", async () => {
            expect(await hears(HANA, "tasks:c1")).toBe(true)
            expect(await hears({ sub: "u3", role: "authenticated", company_id: "c2", super_admin: false }, "tasks:c1")).toBe(false)
            expect(await hears(SARA, "notices:sa1")).toBe(true)
            expect(await hears(HANA, "notices:sa1")).toBe(false)
        })

        it("never stopping the request it's for when it can't be sent", async () => {
            await db.query("SET test.fail_send = 'on'")
            try {
                await db.query(`INSERT INTO "Request"(id, title, details, "userId", "companyId", "updatedAt") VALUES ('rq9', 'Desk', 'One', 'u2', 'c1', now())`)
            } finally {
                await db.query("RESET test.fail_send")
            }
            expect((await db.query(`SELECT count(*)::int AS n FROM "Request" WHERE id = 'rq9'`)).rows[0].n).toBe(1)
            expect(await requestsSent()).toEqual([])
            await db.query(`DELETE FROM "Request" WHERE id = 'rq9'`)
            await sent()
        })
    })

    // Part 4a: the cash advance screens, drawn again as the ledger changes
    // (prisma/migrations/20261211000000_live_advances).
    describe("a company's cash advances", () => {
        const advances = (topic: string) => ({ topic, event: "advances", payload: {}, private: true })
        /** What one statement in a company sends: to its people, and to each Super Admin. */
        const toCompany = (company: string) => [advances(`tasks:${company}`), advances("notices:sa1")]
        const entry = (id: string, company: string, user: string, kind: string, amount: number, task: string | null = null) =>
            `('${id}', '${company}', '${user}', '${kind}', ${amount}, '2026-11-11', 'u1', ${task ? `'${task}'` : "NULL"})`
        const ENTRY_COLUMNS = `"CashAdvanceEntry"(id, "companyId", "userId", kind, amount, date, "recordedById", "taskId")`

        it("an advance given, confirmed and gone, to the company and each Super Admin, saying nothing of what", async () => {
            await db.query(`INSERT INTO ${ENTRY_COLUMNS} VALUES ${entry("ca1", "c1", "u2", "GIVEN", 1000)}`)
            expect(await sent(), "given").toEqual(toCompany("c1"))
            await db.query(`UPDATE "CashAdvanceEntry" SET "confirmedAt" = now() WHERE id = 'ca1'`)
            expect(await sent(), "confirmed").toEqual(toCompany("c1"))
            await db.query(`DELETE FROM "CashAdvanceEntry" WHERE id = 'ca1'`)
            expect(await sent(), "gone").toEqual(toCompany("c1"))
        })

        it("once for each company a statement touched, and once for each Super Admin", async () => {
            await db.query(`INSERT INTO ${ENTRY_COLUMNS} VALUES
                ${entry("ca2", "c1", "u2", "GIVEN", 500)}, ${entry("ca3", "c1", "u1", "GIVEN", 200)}, ${entry("ca4", "c2", "u3", "GIVEN", 300)}`)
            expect(await sent()).toEqual([advances("tasks:c1"), advances("tasks:c2"), advances("notices:sa1")])
            // Nothing changed, nothing to tell.
            await db.query(`UPDATE "CashAdvanceEntry" SET "confirmedAt" = now() WHERE id = 'nobody'`)
            expect(await sent()).toEqual([])
            await db.query(`DELETE FROM "CashAdvanceEntry" WHERE id IN ('ca2', 'ca3', 'ca4')`)
            await sent()
        })

        // The history line says the task is gone: the entry's link to it is
        // cleared by the database, as the task is deleted.
        it("when an entry's task is deleted, as its history line changes", async () => {
            await db.query(`INSERT INTO ${TASK_COLUMNS} VALUES ${task("t-adv", "c1")}`)
            await db.query(`INSERT INTO ${ENTRY_COLUMNS} VALUES ${entry("ca5", "c1", "u2", "SPENT", -150, "t-adv")}`)
            await sent()
            await db.query(`DELETE FROM "Task" WHERE id = 't-adv'`)
            expect((await sent()).filter(s => s.event === "advances")).toEqual(toCompany("c1"))
            expect((await db.query(`SELECT "taskId" FROM "CashAdvanceEntry" WHERE id = 'ca5'`)).rows[0].taskId).toBeNull()
            await db.query(`DELETE FROM "CashAdvanceEntry" WHERE id = 'ca5'`)
            await sent()
        })

        it("heard by the company's people and each Super Admin, and by nobody else", async () => {
            expect(await hears(HANA, "tasks:c1")).toBe(true)
            expect(await hears({ sub: "u3", role: "authenticated", company_id: "c2", super_admin: false }, "tasks:c1")).toBe(false)
            expect(await hears(SARA, "notices:sa1")).toBe(true)
            expect(await hears(HANA, "notices:sa1")).toBe(false)
        })

        it("never stopping the entry it's for when it can't be sent", async () => {
            await db.query("SET test.fail_send = 'on'")
            try {
                await db.query(`INSERT INTO ${ENTRY_COLUMNS} VALUES ${entry("ca9", "c1", "u2", "GIVEN", 50)}`)
            } finally {
                await db.query("RESET test.fail_send")
            }
            expect((await db.query(`SELECT count(*)::int AS n FROM "CashAdvanceEntry" WHERE id = 'ca9'`)).rows[0].n).toBe(1)
            expect(await sent()).toEqual([])
            await db.query(`DELETE FROM "CashAdvanceEntry" WHERE id = 'ca9'`)
            await sent()
        })
    })

    // Part 4b: costs and charges. A cost added or removed comes with its
    // task's own change, in the same transaction (its total and shares),
    // which part 1 already tells the company; so does a share paid. What
    // changes a cost without its task, its charge, is told to the company
    // with a signal of its own. The Super Admin hears every change to costs
    // on their own channel, as they hear no company's with none in view.
    describe("a company's costs and charges", () => {
        const costs = (topic: string) => ({ topic, event: "costs", payload: {}, private: true })
        const changed = (topic: string) => ({ topic, event: "changed", payload: {}, private: true })
        const COST_COLUMNS = `"TaskCost"(id, "taskId", "authorId", amount)`

        beforeAll(async () => {
            await db.query(`INSERT INTO ${TASK_COLUMNS} VALUES ${task("t-cost1", "c1")}, ${task("t-cost2", "c2")}, ${task("t-plain", "c1")}`)
        })

        it("a cost added or removed, to each Super Admin alone: the company hears its task change with it", async () => {
            await db.query(`INSERT INTO ${COST_COLUMNS} VALUES ('k1', 't-cost1', 'u2', 100), ('k2', 't-cost1', 'u2', 50), ('k3', 't-cost2', 'u3', 70)`)
            expect(await sent(), "added").toEqual([costs("notices:sa1")])
            await db.query(`DELETE FROM "TaskCost" WHERE id = 'k2'`)
            expect(await sent(), "removed").toEqual([costs("notices:sa1")])
            // Nothing removed, nothing to tell.
            await db.query(`DELETE FROM "TaskCost" WHERE id = 'nobody'`)
            expect(await sent()).toEqual([])
        })

        // As the app adds one (TaskService.submit): its task first, then the cost.
        it("a cost added with its task, as the app adds it: the company hears the task, each Super Admin the cost", async () => {
            await db.query("BEGIN")
            try {
                await db.query(`UPDATE "Task" SET "totalCost" = 30, status = 'PENDING_CONFIRMATION' WHERE id = 't-plain'`)
                await db.query(`INSERT INTO ${COST_COLUMNS} VALUES ('k4', 't-plain', 'u2', 30)`)
                await db.query("COMMIT")
            } catch (error) {
                await db.query("ROLLBACK")
                throw error
            }
            expect(await sent()).toEqual([changed("tasks:c1"), costs("notices:sa1")])
            await db.query(`DELETE FROM "TaskCost" WHERE id = 'k4'`)
            await db.query(`UPDATE "Task" SET "totalCost" = 0, status = 'IN_PROGRESS' WHERE id = 't-plain'`)
            await sent()
        })

        it("a charge changing, to the company and each Super Admin, saying nothing of what", async () => {
            await db.query(`UPDATE "TaskCost" SET "serviceFee" = 10 WHERE id = 'k1'`)
            expect(await sent(), "a fee").toEqual([costs("tasks:c1"), costs("notices:sa1")])
            await db.query(`UPDATE "TaskCost" SET "notCharged" = true WHERE id = 'k1'`)
            expect(await sent(), "left off").toEqual([costs("tasks:c1"), costs("notices:sa1")])
            await db.query(`UPDATE "TaskCost" SET "notCharged" = false WHERE id = 'k1'`)
            expect(await sent(), "charged again").toEqual([costs("tasks:c1"), costs("notices:sa1")])
            await db.query(`UPDATE "TaskCost" SET "collectedAt" = now(), "collectedById" = 'u1' WHERE id = 'k1'`)
            expect(await sent(), "collected").toEqual([costs("tasks:c1"), costs("notices:sa1")])
            await db.query(`UPDATE "TaskCost" SET "collectedAt" = NULL, "collectedById" = NULL WHERE id = 'k1'`)
            expect(await sent(), "uncollected").toEqual([costs("tasks:c1"), costs("notices:sa1")])
        })

        it("once for each company a statement touched, and once for each Super Admin", async () => {
            await db.query(`UPDATE "TaskCost" SET "collectedAt" = now() WHERE id IN ('k1', 'k3')`)
            expect(await sent()).toEqual([costs("tasks:c1"), costs("tasks:c2"), costs("notices:sa1")])
            // Nothing changed, nothing to tell.
            await db.query(`UPDATE "TaskCost" SET "collectedAt" = NULL WHERE id = 'nobody'`)
            expect(await sent()).toEqual([])
            await db.query(`UPDATE "TaskCost" SET "collectedAt" = NULL WHERE id IN ('k1', 'k3')`)
            await sent()
        })

        // The lists filter by a cost's name from the saved list (CLIENTS_PLAN.md §5.9).
        it("a cost's name merged into another or deleted, as the lists filter by it", async () => {
            await db.query(`INSERT INTO "ListEntry"(id, "companyId", kind, name, "updatedAt") VALUES ('le1', 'c1', 'COST_NAME', 'Fuel', now()), ('le2', 'c1', 'COST_NAME', 'Petrol', now())`)
            await db.query(`UPDATE "TaskCost" SET "nameEntryId" = 'le1' WHERE id = 'k1'`)
            await sent()
            await db.query(`UPDATE "TaskCost" SET "nameEntryId" = 'le2' WHERE "nameEntryId" = 'le1'`)
            expect(await sent(), "merged").toEqual([costs("tasks:c1"), costs("notices:sa1")])
            await db.query(`DELETE FROM "ListEntry" WHERE id = 'le2'`)
            expect(await sent(), "deleted").toEqual([costs("tasks:c1"), costs("notices:sa1")])
            expect((await db.query(`SELECT "nameEntryId" FROM "TaskCost" WHERE id = 'k1'`)).rows[0].nameEntryId).toBeNull()
            await db.query(`DELETE FROM "ListEntry" WHERE id = 'le1'`)
            await sent()
        })

        it("a task with costs changing, to each Super Admin too; one without, to its company alone, as before", async () => {
            await db.query(`UPDATE "Task" SET "memberPaymentStatus" = '{"u2": "PAID"}' WHERE id = 't-cost1'`)
            expect(await sent(), "paid").toEqual([costs("notices:sa1"), changed("tasks:c1")])
            await db.query(`UPDATE "Task" SET title = 'Renamed' WHERE id IN ('t-cost1', 't-cost2')`)
            expect(await sent(), "two companies, one statement").toEqual([costs("notices:sa1"), changed("tasks:c1"), changed("tasks:c2")])
            await db.query(`UPDATE "Task" SET title = 'Renamed' WHERE id = 't-plain'`)
            expect(await sent(), "no costs").toEqual([changed("tasks:c1")])
        })

        // Its costs go with it, before its own trigger could find them.
        it("a task deleted with its costs, to each Super Admin as its costs go, and to its company as before", async () => {
            await db.query(`DELETE FROM "Task" WHERE id = 't-cost2'`)
            const told = await sent()
            expect(told.filter(s => s.event === "costs")).toEqual([costs("notices:sa1")])
            expect(told.filter(s => s.event === "changed")).toEqual([changed("tasks:c2")])
            expect((await db.query(`SELECT count(*)::int AS n FROM "TaskCost" WHERE "taskId" = 't-cost2'`)).rows[0].n).toBe(0)
        })

        it("heard by the company's people and each Super Admin, and by nobody else", async () => {
            expect(await hears(HANA, "tasks:c1")).toBe(true)
            expect(await hears({ sub: "u3", role: "authenticated", company_id: "c2", super_admin: false }, "tasks:c1")).toBe(false)
            expect(await hears(SARA, "notices:sa1")).toBe(true)
            expect(await hears(HANA, "notices:sa1")).toBe(false)
        })

        it("never stopping the change it's for when it can't be sent", async () => {
            await db.query("SET test.fail_send = 'on'")
            try {
                await db.query(`UPDATE "TaskCost" SET "serviceFee" = 25 WHERE id = 'k1'`)
                await db.query(`INSERT INTO ${COST_COLUMNS} VALUES ('k9', 't-cost1', 'u2', 5)`)
            } finally {
                await db.query("RESET test.fail_send")
            }
            expect((await db.query(`SELECT "serviceFee"::float AS fee FROM "TaskCost" WHERE id = 'k1'`)).rows[0].fee).toBe(25)
            expect((await db.query(`SELECT count(*)::int AS n FROM "TaskCost" WHERE id = 'k9'`)).rows[0].n).toBe(1)
            expect(await sent()).toEqual([])
            await db.query(`DELETE FROM "Task" WHERE id IN ('t-cost1', 't-plain')`)
            await sent()
        })
    })

    // Part 4c: attendance, on a channel of its own for each company, which
    // only the attendance lists join (as who's online's is, part 6b): a
    // company's morning check-ins would otherwise reach every open tab.
    describe("a company's attendance", () => {
        const attendance = (company: string) => ({ topic: `attendance:${company}`, event: "changed", payload: {}, private: true })
        /** Only the attendance channels: a flagged punch is a request too (part 2). */
        const heard = async () => (await sent()).filter(s => s.topic.startsWith("attendance:"))
        const PUNCH_COLUMNS = `"AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone")`
        const punch = (id: string, company: string, user: string) => `('${id}', '${company}', '${user}', 'MOBILE', '${id}', '2026-11-12 08:00', '2026-11-12 06:00', 'Africa/Cairo')`
        const DAY_COLUMNS = `"AttendanceDay"(id, "companyId", "userId", date, status, breakdown, "inputsHash")`
        const day = (id: string, company: string, user: string, date: string) => `('${id}', '${company}', '${user}', '${date}', 'PRESENT', '{}', 'h1')`

        it("a check-in's punch, to its company's own channel only, saying nothing of what", async () => {
            await db.query(`INSERT INTO ${PUNCH_COLUMNS} VALUES ${punch("lap1", "c1", "u2")}`)
            const told = await sent()
            expect(told.filter(s => s.topic.startsWith("attendance:"))).toEqual([attendance("c1")])
            // Not the company's channel, which every open tab hears.
            expect(told.filter(s => s.topic === "tasks:c1")).toEqual([])
        })

        it("once per statement for each company it touched", async () => {
            await db.query(`INSERT INTO ${PUNCH_COLUMNS} VALUES ${punch("lap2", "c1", "u1")}, ${punch("lap3", "c1", "u2")}, ${punch("lap4", "c2", "u3")}`)
            expect(await heard()).toEqual([attendance("c1"), attendance("c2")])
        })

        it("a punch withdrawn, its flag decided, or gone", async () => {
            await db.query(`UPDATE "AttendancePunch" SET "voidedAt" = now(), "voidedById" = 'u1', "voidReason" = 'Twice' WHERE id = 'lap2'`)
            expect(await heard(), "withdrawn").toEqual([attendance("c1")])
            await db.query(`UPDATE "AttendancePunch" SET status = 'REJECTED', "reviewedAt" = now() WHERE id = 'lap3'`)
            expect(await heard(), "decided").toEqual([attendance("c1")])
            await db.query(`DELETE FROM "AttendancePunch" WHERE id = 'lap4'`)
            expect(await heard(), "gone").toEqual([attendance("c2")])
        })

        it("not for a change that changed nothing", async () => {
            await db.query(`UPDATE "AttendancePunch" SET note = note WHERE id = 'lap1'`)
            await db.query(`UPDATE "AttendancePunch" SET note = 'x' WHERE id = 'nobody'`)
            expect(await heard()).toEqual([])
        })

        it("a day worked out, and worked out again with other figures, or gone", async () => {
            await db.query(`INSERT INTO ${DAY_COLUMNS} VALUES ${day("lad1", "c1", "u2", "2026-11-12")}, ${day("lad2", "c2", "u3", "2026-11-12")}`)
            expect(await heard(), "worked out").toEqual([attendance("c1"), attendance("c2")])
            await db.query(`UPDATE "AttendanceDay" SET "punchCount" = 2, "lateMinutes" = 12, "inputsHash" = 'h2', "derivedAt" = now() WHERE id = 'lad1'`)
            expect(await heard(), "other figures").toEqual([attendance("c1")])
            await db.query(`DELETE FROM "AttendanceDay" WHERE id = 'lad2'`)
            expect(await heard(), "gone").toEqual([attendance("c2")])
        })

        // The nightly run works out whole months again: only the time it did so changes.
        it("not for a day worked out again with the same figures", async () => {
            await db.query(`UPDATE "AttendanceDay" SET "punchCount" = 2, "lateMinutes" = 12, "inputsHash" = 'h2', "derivedAt" = now() + interval '1 day' WHERE id = 'lad1'`)
            expect(await heard()).toEqual([])
        })

        it("a decision on a day's exception made or undone", async () => {
            await db.query(`INSERT INTO "AttendanceDayDecision"(id, "companyId", "userId", date, subject, outcome, "decidedById") VALUES ('ldd1', 'c1', 'u2', '2026-11-12', 'LATENESS', 'EXCUSED', 'u1')`)
            expect(await heard(), "made").toEqual([attendance("c1")])
            await db.query(`DELETE FROM "AttendanceDayDecision" WHERE id = 'ldd1'`)
            expect(await heard(), "undone").toEqual([attendance("c1")])
        })

        it("a check-in refused, which the Super Admin's Check-ins page counts", async () => {
            await db.query(`INSERT INTO "CheckInRefusal"(id, "companyId", "userId", reason) VALUES ('lcr1', 'c2', 'u3', 'MOCKED_LOCATION')`)
            expect(await heard()).toEqual([attendance("c2")])
            await db.query(`DELETE FROM "CheckInRefusal" WHERE id = 'lcr1'`)
            await db.query(`DELETE FROM "AttendanceDay" WHERE id = 'lad1'`)
            await db.query(`DELETE FROM "AttendancePunch" WHERE id IN ('lap1', 'lap2', 'lap3')`)
            await sent()
        })

        it("heard by those who may see other people's attendance, their own company's only, and the Super Admin, any company's", async () => {
            const sees = { ...HANA, sees_attendance: true }
            expect(await hears(sees, "attendance:c1")).toBe(true)
            expect(await hears(sees, "attendance:c2")).toBe(false)
            expect(await hears({ ...HANA, sees_attendance: false }, "attendance:c1")).toBe(false)
            expect(await hears(HANA, "attendance:c1")).toBe(false)
            expect(await hears(SARA, "attendance:c1")).toBe(true)
            expect(await hears(SARA, "attendance:c2")).toBe(true)
            expect(await hears(SARA, "attendance:c1:x")).toBe(false)
            expect(await hears(sees, "attendance:c1", "presence")).toBe(false)
        })

        it("never stopping the change it's for when it can't be sent", async () => {
            await db.query("SET test.fail_send = 'on'")
            try {
                await db.query(`INSERT INTO ${PUNCH_COLUMNS} VALUES ${punch("lap9", "c1", "u2")}`)
            } finally {
                await db.query("RESET test.fail_send")
            }
            expect((await db.query(`SELECT count(*)::int AS n FROM "AttendancePunch" WHERE id = 'lap9'`)).rows[0].n).toBe(1)
            expect(await heard()).toEqual([])
            await db.query(`DELETE FROM "AttendancePunch" WHERE id = 'lap9'`)
            await sent()
        })

        // Found by Codex on PR 265: the Super Admin's Check-ins page lists,
        // and hears, only the companies that checked in or were refused in
        // the last 30 days. One doing so for the first time in 30 days says
        // so on each Super Admin's own channel, so the page finds it.
        describe("a company found checking in", () => {
            const found = { topic: "notices:sa1", event: "attendance", payload: {}, private: true }
            const told = async () => (await sent()).filter(s => s.event === "attendance")
            const fromPhone = (id: string, company: string, user: string, came = "now()") =>
                `INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone", "receivedAt")
                 VALUES ('${id}', '${company}', '${user}', 'MOBILE', '${id}', '2026-11-12 08:00', '2026-11-12 06:00', 'Africa/Cairo', ${came})`
            const refused = (id: string, company: string, user: string) =>
                `INSERT INTO "CheckInRefusal"(id, "companyId", "userId", reason) VALUES ('${id}', '${company}', '${user}', 'MOCKED_LOCATION')`
            const forget = async () => {
                await db.query(`DELETE FROM "AttendancePunch" WHERE "companyId" IN ('c1', 'c2')`)
                await db.query(`DELETE FROM "CheckInRefusal" WHERE "companyId" IN ('c1', 'c2')`)
                await sent()
            }

            it("its first check-in from the phone app in 30 days, to each Super Admin's own channel, once", async () => {
                await forget()
                // Older than 30 days, or not from the app: the page counts neither.
                await db.query(fromPhone("laf1", "c2", "u3", "now() - interval '31 days'"))
                await db.query(`INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone")
                    VALUES ('laf2', 'c2', 'u3', 'MANUAL', 'laf2', '2026-11-12 08:00', '2026-11-12 06:00', 'Africa/Cairo')`)
                expect(await told(), "old, or by hand").toEqual([])
                await db.query(fromPhone("laf3", "c2", "u3"))
                expect(await told(), "the first").toEqual([found])
                // Listed from then on: its check-ins go on its own channel.
                await db.query(fromPhone("laf4", "c2", "u3"))
                await db.query(refused("lfr1", "c2", "u3"))
                expect(await told(), "after it").toEqual([])
            })

            it("its first refusal in 30 days, and not a check-in after it", async () => {
                await forget()
                await db.query(refused("lfr2", "c2", "u3"))
                expect(await told(), "the first").toEqual([found])
                await db.query(fromPhone("laf5", "c2", "u3"))
                expect(await told(), "after it").toEqual([])
            })

            it("once for a statement that found several", async () => {
                await forget()
                await db.query(`INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone") VALUES
                    ('laf6', 'c1', 'u2', 'MOBILE', 'laf6', '2026-11-12 08:00', '2026-11-12 06:00', 'Africa/Cairo'),
                    ('laf7', 'c1', 'u1', 'MOBILE', 'laf7', '2026-11-12 08:00', '2026-11-12 06:00', 'Africa/Cairo'),
                    ('laf8', 'c2', 'u3', 'MOBILE', 'laf8', '2026-11-12 08:00', '2026-11-12 06:00', 'Africa/Cairo')`)
                expect(await told()).toEqual([found])
                await forget()
            })
        })
    })

    // Part 6b: who's online, from each tab's row (part 6a). Written as the
    // app writes it (UserService.tabSeen): one statement that keeps a report
    // only if none after it has arrived.
    describe("who's online", () => {
        const online = (company: string) => ({ topic: `online:${company}`, event: "changed", payload: {}, private: true })
        const AT = Date.parse("2026-11-12T09:00:00Z")
        const minutes = (n: number) => new Date(AT + n * 60_000).toISOString()
        const report = (user: string, tab: string, here: boolean, seq: number, at: string, sid = "s1") => db.query(`
            INSERT INTO "OpenTab" ("userId", "tabId", "seenAt", "seq", "here", "sid")
            VALUES ($1, $2, ($3::timestamptz AT TIME ZONE 'UTC'), $4, $5, $6)
            ON CONFLICT ("userId", "tabId") DO UPDATE
            SET "seenAt" = EXCLUDED."seenAt", "seq" = EXCLUDED."seq", "here" = EXCLUDED."here", "sid" = EXCLUDED."sid"
            WHERE "OpenTab"."seq" <= EXCLUDED."seq" OR "OpenTab"."sid" IS DISTINCT FROM EXCLUDED."sid"`, [user, tab, at, seq, here, sid])

        beforeEach(async () => {
            await db.query(`DELETE FROM "OpenTab"`)
            await sent()
        })

        it("a tab here for the first time, gone, and here again, to its person's company, saying nothing of who", async () => {
            await report("u2", "tab-a", true, 1, minutes(0))
            expect(await sent(), "here").toEqual([online("c1")])
            await report("u2", "tab-a", false, 2, minutes(1))
            expect(await sent(), "gone").toEqual([online("c1")])
            await report("u2", "tab-a", true, 3, minutes(2))
            expect(await sent(), "here again").toEqual([online("c1")])
        })

        it("not the heartbeat's beat, which keeps a tab here as it was, nor a report kept out by the order", async () => {
            await report("u2", "tab-a", true, 1, minutes(0))
            await sent()
            await report("u2", "tab-a", true, 2, minutes(15))
            await report("u2", "tab-a", true, 3, minutes(30))
            expect(await sent(), "beats").toEqual([])
            await report("u2", "tab-a", false, 1, minutes(31))
            expect(await sent(), "a report from before the last").toEqual([])
            expect((await db.query(`SELECT here FROM "OpenTab" WHERE "tabId" = 'tab-a'`)).rows[0].here).toBe(true)
        })

        // A phone pauses the page out of sight, and the tab's row runs out
        // with nothing written: coming back is a coming, though the row says
        // here throughout.
        it("a tab here again after its row ran out, as a phone wakes the app", async () => {
            await report("u2", "tab-a", true, 1, minutes(0))
            await sent()
            await report("u2", "tab-a", true, 2, minutes(32))
            expect(await sent(), "within the window").toEqual([])
            await report("u2", "tab-a", true, 3, minutes(65))
            expect(await sent(), "after it ran out").toEqual([online("c1")])
        })

        it("signing out, once for the statement however many tabs it closed", async () => {
            await report("u2", "tab-a", true, 1, minutes(0))
            await report("u2", "tab-b", true, 1, minutes(0))
            await report("u2", "tab-c", false, 2, minutes(0))
            await sent()
            // As UserService.closeSessionTabs writes it.
            await db.query(`UPDATE "OpenTab" SET here = false, "seenAt" = $1::timestamp, seq = 2147483647
                WHERE "userId" = 'u2' AND sid = 's1' AND (here OR seq < 2147483647)`, [minutes(1)])
            expect(await sent()).toEqual([online("c1")])
        })

        it("once for each company a statement touched", async () => {
            await db.query(`INSERT INTO "OpenTab" ("userId", "tabId", "seenAt", seq, here, sid) VALUES
                ('u1', 'tab-1', now(), 1, true, 's'), ('u2', 'tab-2', now(), 1, true, 's'), ('u3', 'tab-3', now(), 1, true, 's')`)
            expect(await sent()).toEqual([online("c1"), online("c2")])
            // Nothing changed, nothing to tell.
            await db.query(`UPDATE "OpenTab" SET seq = 2 WHERE "tabId" = 'nobody'`)
            expect(await sent()).toEqual([])
        })

        it("not a tab that arrives already gone, nor the daily sweep of rows that ran out", async () => {
            await report("u2", "tab-a", false, 1, minutes(0))
            expect(await sent(), "arrives gone").toEqual([])
            await report("u2", "tab-b", true, 1, minutes(0))
            await sent()
            await db.query(`DELETE FROM "OpenTab" WHERE "seenAt" < $1::timestamp`, [minutes(40)])
            expect(await sent(), "swept").toEqual([])
        })

        it("heard by those of the company who may see the Employees list, and each Super Admin, and nobody else", async () => {
            const LISTS = { ...HANA, sees_online: true }
            expect(await hears(LISTS, "online:c1")).toBe(true)
            expect(await hears(LISTS, "online:c2")).toBe(false)
            expect(await hears(HANA, "online:c1"), "without the Employees list").toBe(false)
            expect(await hears({ ...LISTS, company_id: null }, "online:")).toBe(false)
            expect(await hears(SARA, "online:c1")).toBe(true)
            expect(await hears(SARA, "online:c2")).toBe(true)
            expect(await hears(SARA, "online:c1:x")).toBe(false)
            expect(await hears(LISTS, "online:c1", "presence")).toBe(false)
            expect(await hears(null, "online:c1")).toBe(false)
            // And the list's channel opens no other.
            expect(await hears(LISTS, "tasks:c1")).toBe(true)
            expect(await hears(LISTS, "notices:u2")).toBe(false)
        })

        it("never stopping the report it's for when it can't be sent", async () => {
            await db.query("SET test.fail_send = 'on'")
            try {
                await report("u2", "tab-z", true, 1, minutes(0))
            } finally {
                await db.query("RESET test.fail_send")
            }
            expect((await db.query(`SELECT count(*)::int AS n FROM "OpenTab" WHERE "tabId" = 'tab-z'`)).rows[0].n).toBe(1)
            expect(await sent()).toEqual([])
        })
    })

    describe("a signal that can't be sent", () => {
        it("never stops the change from being saved", async () => {
            await db.query("SET test.fail_send = 'on'")
            try {
                await db.query(`INSERT INTO ${TASK_COLUMNS} VALUES ${task("t5", "c1")}`)
                await db.query(`INSERT INTO "Notification"(id, "userId", type, message) VALUES ('n5', 'u2', 'X', 'v')`)
            } finally {
                await db.query("RESET test.fail_send")
            }
            expect((await db.query(`SELECT count(*)::int AS n FROM "Task" WHERE id = 't5'`)).rows[0].n).toBe(1)
            expect((await db.query(`SELECT count(*)::int AS n FROM "Notification" WHERE id = 'n5'`)).rows[0].n).toBe(1)
            expect(await topics()).toEqual([])
        })

        it("nor does Supabase's Realtime missing altogether, as in the Postgres the other tests use", async () => {
            await db.query(`ALTER FUNCTION realtime.send(jsonb, text, text, boolean) RENAME TO send_away`)
            try {
                await db.query(`INSERT INTO ${TASK_COLUMNS} VALUES ${task("t6", "c1")}`)
                await db.query(`INSERT INTO "Notification"(id, "userId", type, message) VALUES ('n6', 'u2', 'X', 'u')`)
            } finally {
                await db.query(`ALTER FUNCTION realtime.send_away(jsonb, text, text, boolean) RENAME TO send`)
            }
            expect((await db.query(`SELECT count(*)::int AS n FROM "Task" WHERE id = 't6'`)).rows[0].n).toBe(1)
        })
    })

    describe("who may listen", () => {
        it("a company's person hears their company's tasks, and their own notices, only", async () => {
            expect(await hears(HANA, "tasks:c1")).toBe(true)
            expect(await hears(HANA, "notices:u1")).toBe(true)
            expect(await hears(HANA, "tasks:c2")).toBe(false)
            expect(await hears(HANA, "notices:u2")).toBe(false)
        })

        it("the Super Admin hears any company's tasks, and their own notices, only", async () => {
            expect(await hears(SARA, "tasks:c1")).toBe(true)
            expect(await hears(SARA, "tasks:c2")).toBe(true)
            expect(await hears(SARA, "notices:sa1")).toBe(true)
            expect(await hears(SARA, "notices:u1")).toBe(false)
        })

        it("nobody hears anything without a token, or a topic of another shape, or anything but broadcasts", async () => {
            expect(await hears(null, "tasks:c1")).toBe(false)
            expect(await hears({ sub: "u1", role: "authenticated" }, "tasks:c1")).toBe(false)
            expect(await hears(HANA, "tasks:c1:x")).toBe(false)
            expect(await hears(HANA, "tasks:")).toBe(false)
            expect(await hears(HANA, "tasks:c1", "presence")).toBe(false)
        })

        it("and nobody may send on them: the browser only listens", async () => {
            await db.query("BEGIN")
            try {
                await db.query("SET LOCAL ROLE authenticated")
                await db.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('realtime.topic', 'tasks:c1', true)`, [JSON.stringify(HANA)])
                await expect(db.query(`INSERT INTO realtime.messages(topic, extension, payload, event) VALUES ('tasks:c1', 'broadcast', '{}', 'changed')`)).rejects.toThrow(/row-level security/)
            } finally {
                await db.query("ROLLBACK")
            }
        })
    })
})
