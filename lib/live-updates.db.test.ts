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
                expect(await sent(), "asked for").toEqual(toCompany("c1"))
                await db.query(`UPDATE ${table} SET ${change}`)
                expect(await sent(), "changed").toEqual(toCompany("c1"))
                await db.query(`DELETE FROM ${table}`)
                expect(await sent(), "withdrawn").toEqual(toCompany("c1"))
            })
        }

        it("day off and name changes, which carry only their person, to the person's company", async () => {
            await db.query(`INSERT INTO "DayOffRequest"(id, "userId", type, date, "updatedAt") VALUES ('do1', 'u3', 'REGULAR', '2026-11-12', now())`)
            expect(await sent()).toEqual(toCompany("c2"))
            await db.query(`UPDATE "DayOffRequest" SET status = 'APPROVED' WHERE id = 'do1'`)
            expect(await sent()).toEqual(toCompany("c2"))
            await db.query(`DELETE FROM "DayOffRequest" WHERE id = 'do1'`)
            expect(await sent()).toEqual(toCompany("c2"))
            await db.query(`INSERT INTO "ProfileUpdateRequest"(id, "userId", "oldFirstName", "oldLastName", "newFirstName", "newLastName", "updatedAt") VALUES ('pu1', 'u2', 'Youssef', 'One', 'Yusuf', 'One', now())`)
            expect(await sent()).toEqual(toCompany("c1"))
            await db.query(`UPDATE "ProfileUpdateRequest" SET status = 'REJECTED' WHERE id = 'pu1'`)
            expect(await sent()).toEqual(toCompany("c1"))
            await db.query(`DELETE FROM "ProfileUpdateRequest" WHERE id = 'pu1'`)
            expect(await sent()).toEqual(toCompany("c1"))
        })

        it("once for each company a statement touched, and once for each Super Admin", async () => {
            await db.query(`INSERT INTO "Request"(id, title, details, "userId", "companyId", "updatedAt") VALUES
                ('rq2', 'A', 'a', 'u2', 'c1', now()), ('rq3', 'B', 'b', 'u1', 'c1', now()), ('rq4', 'C', 'c', 'u3', 'c2', now())`)
            expect(await sent()).toEqual([requests("tasks:c1"), requests("tasks:c2"), requests("notices:sa1")])
            await db.query(`UPDATE "Request" SET status = 'DONE' WHERE id IN ('rq2', 'rq3')`)
            expect(await sent()).toEqual(toCompany("c1"))
            // Nothing changed, nothing to tell.
            await db.query(`UPDATE "Request" SET status = 'DONE' WHERE id = 'nobody'`)
            expect(await sent()).toEqual([])
            await db.query(`DELETE FROM "Request"`)
            await sent()
        })

        it("overtime: a day's waiting, worked out again or decided, and not every day worked out", async () => {
            const day = (set: string) => db.query(`UPDATE "AttendanceDay" SET ${set} WHERE id = 'ad1'`)
            await db.query(`INSERT INTO "AttendanceDay"(id, "companyId", "userId", date, status, breakdown, "inputsHash") VALUES ('ad1', 'c1', 'u2', '2026-11-10', 'PRESENT', '{}', 'h1')`)
            await day(`"inputsHash" = 'h2', "lastOutAt" = '2026-11-10 17:00'`)
            expect(await sent(), "a day without overtime, worked out").toEqual([])
            await day(`"overtimeStatus" = 'PENDING', "overtimeMinutes" = 60`)
            expect(await sent(), "its overtime waits").toEqual(toCompany("c1"))
            await day(`"overtimeMinutes" = 75, "lastOutAt" = '2026-11-10 18:15'`)
            expect(await sent(), "and is worked out again").toEqual(toCompany("c1"))
            await day(`"inputsHash" = 'h3'`)
            expect(await sent(), "nothing the row shows").toEqual([])
            await day(`"overtimeStatus" = 'APPROVED'`)
            expect(await sent(), "decided").toEqual(toCompany("c1"))
            await day(`"overtimeMinutes" = 90`)
            expect(await sent(), "worked out again once decided").toEqual([])
            await db.query(`DELETE FROM "AttendanceDay" WHERE id = 'ad1'`)
            expect(await sent(), "a decided day gone").toEqual([])
        })

        it("flagged check-ins: flagged, reviewed or withdrawn, and not every check-in", async () => {
            const punch = (id: string, status: string) => db.query(
                `INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone", status)
                 VALUES ($1, 'c1', 'u2', 'MOBILE', $1, '2026-11-10 09:00', '2026-11-10 07:00', 'Africa/Cairo', $2::"PunchStatus")`, [id, status])
            await punch("ap1", "ACCEPTED")
            const withdraw = (id: string) => db.query(`UPDATE "AttendancePunch" SET "voidedAt" = now(), "voidedById" = 'u1', "voidReason" = 'Wrong' WHERE id = $1`, [id])
            await withdraw("ap1")
            expect(await sent(), "a check-in, and one withdrawn").toEqual([])
            await punch("ap2", "FLAGGED")
            expect(await sent(), "flagged").toEqual(toCompany("c1"))
            await db.query(`UPDATE "AttendancePunch" SET status = 'ACCEPTED', "reviewedAt" = now() WHERE id = 'ap2'`)
            expect(await sent(), "reviewed").toEqual(toCompany("c1"))
            await withdraw("ap2")
            expect(await sent(), "a reviewed one withdrawn").toEqual(toCompany("c1"))
            await db.query(`DELETE FROM "AttendancePunch" WHERE id = 'ap1'`)
            expect(await sent(), "a check-in gone").toEqual([])
        })

        it("check-in phones: asked for and decided, and not used", async () => {
            await db.query(`INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform) VALUES ('ph1', 'c1', 'u2', 'k', 'f1', 'IOS')`)
            expect(await sent(), "asked for").toEqual(toCompany("c1"))
            await db.query(`UPDATE "CheckInPhone" SET "appAttestCounter" = "appAttestCounter" + 1, "pushToken" = 'tok', "pushTokenAt" = now() WHERE id = 'ph1'`)
            expect(await sent(), "used").toEqual([])
            await db.query(`UPDATE "CheckInPhone" SET status = 'ACTIVE', "decidedAt" = now() WHERE id = 'ph1'`)
            expect(await sent(), "decided").toEqual(toCompany("c1"))
            await db.query(`DELETE FROM "CheckInPhone" WHERE id = 'ph1'`)
            expect(await sent(), "gone").toEqual(toCompany("c1"))
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
            expect(await sent()).toEqual([])
            await db.query(`DELETE FROM "Request" WHERE id = 'rq9'`)
            await sent()
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
