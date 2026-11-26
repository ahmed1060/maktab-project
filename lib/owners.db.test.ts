import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { calendarDateStr } from "@/lib/time"
import { addDays } from "@/lib/attendance/calendar"
import { startOfDate } from "@/lib/contract-start"

/**
 * Owners (LATER_CHANGES_PLAN.md §7.3, step 3a, PR 426), against a real
 * Postgres: the migration gives each company's Admin role the permission to
 * mark them; marking someone starts a period from the start of this month,
 * logged, after which the payroll register leaves them out and attendance
 * counts no days for them, the months before as they were; taking it off
 * ends the period, or takes it back where it started this month; and it's
 * refused with work still open, or in a month whose payroll is approved.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const ZONE = "Africa/Cairo"
const today = calendarDateStr(new Date(), ZONE)
const thisMonth = today.slice(0, 7)
const lastMonth = addDays(`${thisMonth}-01`, -1).slice(0, 7)
const startOf = (month: string) => startOfDate(`${month}-01`, ZONE)
const hiredAt = startOfDate(addDays(`${lastMonth}-01`, -20), ZONE).toISOString()

// Made-up people, each hired before last month with a salary dated the same.
const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Made Up', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1'),
 ('e3', 'e3@x', 'p', 'Essam', 'One', 'EMPLOYEE', 2026, 'e3', 'c1'),
 ('e4', 'e4@x', 'p', 'Eid', 'One', 'EMPLOYEE', 2026, 'e4', 'c1'),
 ('n1', 'n1@x', 'p', 'Nour', 'One', 'EMPLOYEE', 2026, 'n1', NULL);
`
const RECORDS = `
INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES
 ('h1', 'e1', 'HIRED', '${hiredAt}'), ('h2', 'e2', 'HIRED', '${hiredAt}'), ('h3', 'e3', 'HIRED', '${hiredAt}'), ('h4', 'e4', 'HIRED', '${hiredAt}');
INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES
 ('s1', 'e1', 9300, '${hiredAt}'), ('s2', 'e2', 9300, '${hiredAt}'), ('s3', 'e3', 9300, '${hiredAt}'), ('s4', 'e4', 9300, '${hiredAt}');
INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone") VALUES
 ('p1', 'c1', 'e1', 'MANUAL', 'p1', '${lastMonth}-01T09:00:00', '${startOfDate(`${lastMonth}-01`, ZONE).toISOString()}', '${ZONE}');
`

const by = { userId: "a1", superAdminId: null }

describe.skipIf(!ADMIN_URL)("owners, in Postgres", () => {
    const dbName = `owners_test_${Date.now()}`
    let db: Client
    let Owners: typeof import("@/lib/services/owner.service").OwnerService
    let prisma: typeof import("@/lib/prisma").prisma
    let versionsBefore: { id: string; builtIn: string | null; version: number }[] = []
    // Just after it: a later migration raising them again is its own.
    let versionsAfter: { id: string; version: number }[] = []

    const periodsOf = async (userId: string) => (await db.query(`SELECT "startsAt", "endsAt" FROM "OwnerPeriod" WHERE "userId" = $1 ORDER BY "startsAt"`, [userId])).rows
        .map(r => [r.startsAt.toISOString(), r.endsAt?.toISOString() ?? null])
    const refusal = (p: Promise<unknown>) => p.then(() => "changed", (e: Error) => e.message)
    const onRegister = async (month: string) => {
        const { PayrollRunService } = await import("@/lib/services/payroll-run.service")
        const { register } = await PayrollRunService.compute("c1", Number(month.slice(0, 4)), Number(month.slice(5, 7)))
        return register.entries.map((e: { userId: string }) => e.userId).sort()
    }
    const daysOf = async (userId: string, month: string) => Number((await db.query(
        `SELECT count(*) FROM "AttendanceDay" WHERE "userId" = $1 AND to_char(date, 'YYYY-MM') = $2`, [userId, month])).rows[0].count)

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
            // The roles' versions before the migration that gives the Admin's the permission.
            if (m === "20270123000000_owner_periods") versionsBefore = (await db.query(`SELECT id, "builtIn", version FROM "Role" ORDER BY id`)).rows
            await db.query(sql(m))
            if (m === "20270123000000_owner_periods") versionsAfter = (await db.query(`SELECT id, version FROM "Role" ORDER BY id`)).rows
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(RECORDS)
        await db.query(`UPDATE "Company" SET timezone = '${ZONE}'`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Owners = (await import("@/lib/services/owner.service")).OwnerService
        prisma = (await import("@/lib/prisma")).prisma
        // Their days, worked out before anyone is marked.
        const { AttendanceEngineService } = await import("@/lib/services/attendance-engine.service")
        await AttendanceEngineService.recomputeMonth("c1", lastMonth)
        await AttendanceEngineService.recomputeMonth("c1", thisMonth)
    }, 180_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    it("gives each company's Admin role the permission, and has its holders reload", async () => {
        const admins = versionsBefore.filter(r => r.builtIn === "ADMIN")
        expect(admins.length).toBe(1)
        const grants = (await db.query(`SELECT "roleId", scope FROM "RoleGrant" WHERE permission = 'employees.set_owner' ORDER BY "roleId"`)).rows
        expect(grants).toEqual(admins.map(r => ({ roleId: r.id, scope: "COMPANY" })))
        expect(versionsAfter).toEqual(versionsBefore.map(r => ({ id: r.id, version: r.builtIn === "ADMIN" ? r.version + 1 : r.version })))
    })

    it("holds one open period each, ending after it starts", async () => {
        const open = (id: string, at: string) => db.query(`INSERT INTO "OwnerPeriod"(id, "userId", "startsAt") VALUES ($1, 'e4', $2)`, [id, at])
        await open("x1", startOf(lastMonth).toISOString())
        await expect(open("x2", startOf(thisMonth).toISOString())).rejects.toThrow(/OwnerPeriod_one_open/)
        await expect(db.query(`UPDATE "OwnerPeriod" SET "endsAt" = "startsAt" WHERE id = 'x1'`)).rejects.toThrow(/OwnerPeriod_ends_after_start/)
        await db.query(`DELETE FROM "OwnerPeriod" WHERE "userId" = 'e4'`)
    })

    it("marks someone an owner from the start of this month, and logs it", async () => {
        expect(await onRegister(thisMonth)).toContain("e1")
        expect(await Owners.set("e1", true, by)).toEqual({ owner: true, month: thisMonth })
        expect(await periodsOf("e1")).toEqual([[startOf(thisMonth).toISOString(), null]])
        expect(await Owners.of("e1")).toEqual({ since: thisMonth })
        const log = (await db.query(`SELECT action, "entityId", details, "userId" FROM "AuditLog" WHERE action LIKE 'OWNER_%'`)).rows
        expect(log).toEqual([{ action: "OWNER_MARKED", entityId: "e1", details: { month: thisMonth }, userId: "a1" }])
    })

    it("leaves them off this month's register, last month's keeping them", async () => {
        expect(await onRegister(thisMonth)).not.toContain("e1")
        expect(await onRegister(lastMonth)).toContain("e1")
    })

    it("works out no days for them this month, last month's as they were", async () => {
        expect(await daysOf("e1", thisMonth)).toBe(0)
        expect(await daysOf("e1", lastMonth)).toBeGreaterThan(0)
    })

    it("takes it off in the month it was put on as if it never was", async () => {
        expect(await Owners.set("e1", false, by)).toEqual({ owner: false, month: thisMonth })
        expect(await periodsOf("e1")).toEqual([])
        expect(await Owners.of("e1")).toBeNull()
        expect(await onRegister(thisMonth)).toContain("e1")
        const log = (await db.query(`SELECT action FROM "AuditLog" WHERE action LIKE 'OWNER_%' ORDER BY "createdAt"`)).rows.map(r => r.action)
        expect(log).toEqual(["OWNER_MARKED", "OWNER_UNMARKED"])
    })

    it("ends a period that started before this month there, the months before staying an owner's", async () => {
        await db.query(`INSERT INTO "OwnerPeriod"(id, "userId", "startsAt") VALUES ('was', 'e2', $1)`, [startOf(lastMonth).toISOString()])
        expect(await onRegister(lastMonth)).not.toContain("e2")
        await Owners.set("e2", false, by)
        expect(await periodsOf("e2")).toEqual([[startOf(lastMonth).toISOString(), startOf(thisMonth).toISOString()]])
        expect(await onRegister(lastMonth)).not.toContain("e2")
        expect(await onRegister(thisMonth)).toContain("e2")
        // Marked again this month, the period carries on.
        await Owners.set("e2", true, by)
        expect(await periodsOf("e2")).toEqual([[startOf(lastMonth).toISOString(), null]])
    })

    it("refuses someone with work still open, naming it, and leaves them as they were", async () => {
        await db.query(`INSERT INTO "Task"(id, title, description, status, deadline, "updatedAt", "companyId") VALUES
            ('t1', 'File the October return', '', 'IN_PROGRESS', now() - interval '2 minutes', now(), 'c1'),
            ('t2', 'Done already', '', 'COMPLETED', now(), now(), 'c1'),
            ('t3', 'Awaiting review', '', 'PENDING_CONFIRMATION', now(), now(), 'c1'),
            ('t4', 'Someone else''s', '', 'IN_PROGRESS', now(), now(), 'c1')`)
        await db.query(`UPDATE "Task" SET "createdAt" = now() - interval '1 minute' WHERE id = 't3'`)
        await db.query(`UPDATE "Task" SET "createdAt" = now() - interval '2 minutes' WHERE id = 't1'`)
        await db.query(`INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('t1', 'e3'), ('t2', 'e3'), ('t3', 'e3'), ('t4', 'e4')`)
        await db.query(`INSERT INTO "Obligation"(id, title, description, deadline, status, "updatedAt", "companyId") VALUES
            ('o1', 'Quarterly VAT', '', now(), 'PENDING', now(), 'c1'),
            ('o2', 'Someone else''s', '', now(), 'IN_PROGRESS', now(), 'c1')`)
        await db.query(`INSERT INTO "_ObligationAssignees"("A", "B") VALUES ('o1', 'e3'), ('o2', 'e4')`)
        const refused = await Owners.set("e3", true, by).then(() => null, (e: Error & { work?: unknown }) => e)
        expect(refused?.message).toBe("OWNER_OPEN_WORK")
        // A task awaiting review is still theirs; a finished one stays in their history; someone else's isn't theirs.
        expect(refused?.work).toEqual([
            { kind: "task", id: "t1", title: "File the October return" },
            { kind: "task", id: "t3", title: "Awaiting review" },
            { kind: "obligation", id: "o1", title: "Quarterly VAT" },
        ])
        expect(await periodsOf("e3")).toEqual([])
    })

    it("refuses in a month whose payroll is approved", async () => {
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt") VALUES ('run', 'c1', $1, $2, 'APPROVED', 25, now())`, [Number(thisMonth.slice(5, 7)), Number(thisMonth.slice(0, 4))])
        try {
            expect(await refusal(Owners.set("e4", true, by))).toBe("PAYROLL_MONTH_LOCKED")
            expect(await periodsOf("e4")).toEqual([])
        } finally {
            await db.query(`DELETE FROM "PayrollRun" WHERE id = 'run'`)
        }
    })

    it("refuses what they are already, and someone not in a company", async () => {
        expect(await refusal(Owners.set("e2", true, by))).toBe("ALREADY_OWNER")
        expect(await refusal(Owners.set("e4", false, by))).toBe("NOT_OWNER")
        expect(await refusal(Owners.set("nobody", true, by))).toBe("NO_COMPANY")
        expect(await refusal(Owners.set("n1", true, by))).toBe("NO_COMPANY")
    })
})
