import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * The work an owner isn't given (LATER_CHANGES_PLAN.md §7.3, step 3b2, PR
 * 428), against a real Postgres: the pickers leave out an owner now, and
 * giving one work is refused, for the Super Admin too, with nothing written;
 * work being given someone makes marking them wait, and then see it; and a
 * repeating obligation still to make its next one refuses marking its
 * person, until its next one is made and moved. Only an Admin is one, not
 * someone acting as one, and an owner's role stays Admin.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

// Made-up people: Admins, who can be owners, but for e4, an employee (PR 428).
const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt", timezone) VALUES ('c1', 'Made Up', now(), 'Africa/Cairo');
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'ADMIN', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'ADMIN', 2026, 'e2', 'c1'),
 ('e3', 'e3@x', 'p', 'Essam', 'One', 'ADMIN', 2026, 'e3', 'c1'),
 ('e4', 'e4@x', 'p', 'Eid', 'One', 'EMPLOYEE', 2026, 'e4', 'c1'),
 ('e5', 'e5@x', 'p', 'Ezz', 'One', 'ADMIN', 2026, 'e5', 'c1');
`

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1" }) }
const superAdmin = { user: { id: "sa", role: "SUPER_ADMIN", companyId: null, name: "Nizmo" } }
const by = { userId: "a1", superAdminId: null }
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

describe.skipIf(!ADMIN_URL)("the work an owner isn't given, in Postgres", () => {
    const dbName = `owners_work_test_${Date.now()}`
    let db: Client
    let prisma: typeof import("@/lib/prisma").prisma
    let Owners: typeof import("@/lib/services/owner.service").OwnerService

    const refusal = (p: Promise<unknown>) => p.then(() => "changed", (e: Error & { work?: unknown }) => e.message)
    const obligationsOf = async (userId: string) => (await db.query(
        `SELECT o.id, o.status FROM "Obligation" o JOIN "_ObligationAssignees" a ON a."A" = o.id WHERE a."B" = $1 ORDER BY o."createdAt"`, [userId])).rows

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
        await db.query(`INSERT INTO "SuperAdmin"(id, email, username, password, "firstName", "lastName", "updatedAt") VALUES ('sa', 'sa@x', 'sa', 'p', 'Sara', 'Admin', now())`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        prisma = (await import("@/lib/prisma")).prisma
        Owners = (await import("@/lib/services/owner.service")).OwnerService
        await Owners.set("e3", true, by)
    }, 180_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    it("leaves an owner now out of the pickers that hand out work, and Attendance's", async () => {
        const { assignableChoices } = await import("@/lib/services/assignee-guard")
        for (const permission of ["tasks.create", "obligations.create", "obligations.edit", "tasks.transfer"] as const) {
            expect((await assignableChoices(admin, permission, "c1")).map(p => p.id).sort(), permission).toEqual(["a1", "e1", "e2", "e4", "e5"])
        }
        const { AttendancePunchService } = await import("@/lib/services/attendance-punch.service")
        expect((await AttendancePunchService.people("c1", { kind: "COMPANY" })).map(p => p.id).sort()).toEqual(["a1", "e1", "e2", "e4", "e5"])
    })

    it("refuses giving an owner a task or an obligation, the Super Admin too, with nothing written", async () => {
        const { ObligationService } = await import("@/lib/services/obligation.service")
        const { TaskService } = await import("@/lib/services/task.service")
        const obligation = { title: "Made-up filing", description: "A made-up obligation", assigneeIds: ["e3"], deadline: inDays(3), recurrence: "ONE_TIME", difficulty: 1 } as never
        expect(await refusal(ObligationService.create(obligation, admin))).toBe("ASSIGNEE_IS_OWNER")
        expect(await refusal(ObligationService.create(obligation, superAdmin))).toBe("ASSIGNEE_IS_OWNER")
        const task = { title: "Made-up visit", description: "A made-up task", assigneeIds: ["e3"], deadline: inDays(3), difficulty: 1, locationId: "anywhere" } as never
        expect(await refusal(TaskService.create(task, admin))).toBe("ASSIGNEE_IS_OWNER")
        expect(await refusal(TaskService.create(task, superAdmin))).toBe("ASSIGNEE_IS_OWNER")
        expect(await obligationsOf("e3")).toEqual([])
        expect(Number((await db.query(`SELECT count(*) FROM "_MultipleAssignees" WHERE "B" = 'e3'`)).rows[0].count)).toBe(0)

        // Reassigning one to them too; its people as they were.
        const mine = await ObligationService.create({ ...(obligation as object), assigneeIds: ["e1"] } as never, admin)
        expect(await refusal(ObligationService.update(mine.id, { assigneeIds: ["e1", "e3"] }, admin))).toBe("ASSIGNEE_IS_OWNER")
        expect((await obligationsOf("e1")).map(o => o.id)).toEqual([mine.id])
        expect(await obligationsOf("e3")).toEqual([])
        await db.query(`DELETE FROM "Obligation" WHERE id = $1`, [mine.id])
    })

    it("refuses a transfer to an owner kept on the task, and makes its copy for the others once they're left off", async () => {
        const { TaskService } = await import("@/lib/services/task.service")
        // Finished before they were marked: in their history, so marking didn't wait on it.
        const done = await prisma.task.create({
            data: { title: "Made-up audit", description: "Finished before marking", companyId: "c1", deadline: new Date(inDays(3)), status: "COMPLETED", assignees: { connect: [{ id: "e1" }, { id: "e3" }] } },
        })
        expect(await refusal(TaskService.transfer(done.id, admin, { newAssigneeIds: ["e3", "e4"] }))).toBe("ASSIGNEE_IS_OWNER")
        expect(await refusal(TaskService.transfer(done.id, admin, { newAssigneeIds: ["e1", "e3"] }))).toBe("ASSIGNEE_IS_OWNER")
        expect((await db.query(`SELECT status FROM "Task" WHERE id = $1`, [done.id])).rows[0].status).toBe("COMPLETED")
        expect(Number((await db.query(`SELECT count(*) FROM "Task" WHERE title LIKE 'Made-up audit%'`)).rows[0].count)).toBe(1)

        expect(await refusal(TaskService.transfer(done.id, admin, { newAssigneeIds: ["e1", "e4"] }))).toBe("changed")
        const copy = (await db.query(`SELECT id FROM "Task" WHERE title = 'Made-up audit (Transfer Copy)'`)).rows
        expect(copy).toHaveLength(1)
        expect((await db.query(`SELECT "B" FROM "_MultipleAssignees" WHERE "A" = $1 ORDER BY "B"`, [copy[0].id])).rows.map(r => r.B)).toEqual(["e1", "e4"])
        await db.query(`DELETE FROM "Task" WHERE title LIKE 'Made-up audit%'`)
    })

    it("makes marking someone wait on work being given them, and then see it", async () => {
        const { holdAssignees } = await import("@/lib/services/owner.service")
        let release!: () => void
        const released = new Promise<void>(resolve => { release = resolve })
        let held!: () => void
        const holding = new Promise<void>(resolve => { held = resolve })
        let given = ""
        const giving = prisma.$transaction(async tx => {
            expect((await holdAssignees(tx, ["e2"])).size).toBe(0)
            given = (await tx.obligation.create({
                data: { title: "Made-up report", description: "Given while marked", companyId: "c1", deadline: new Date(inDays(3)), status: "PENDING", assignees: { connect: [{ id: "e2" }] } },
            })).id
            held()
            await released
        }, { timeout: 20_000 })
        await holding
        let settled = false
        const marking = refusal(Owners.set("e2", true, by)).then(r => { settled = true; return r })
        await new Promise(resolve => setTimeout(resolve, 800))
        expect(settled).toBe(false)
        release()
        await giving
        expect(await marking).toBe("OWNER_OPEN_WORK")
        expect(Number((await db.query(`SELECT count(*) FROM "OwnerPeriod" WHERE "userId" = 'e2'`)).rows[0].count)).toBe(0)
        await db.query(`DELETE FROM "Obligation" WHERE id = $1`, [given])
    })

    it("marks only an Admin, not an employee or someone acting as Admin for a while, and takes anyone off", async () => {
        expect(await refusal(Owners.set("e4", true, by))).toBe("OWNER_NOT_ADMIN")
        await db.query(`UPDATE "User" SET "actingUntil" = now() + interval '3 days', "returnRoleId" = "roleId" WHERE id = 'e5'`)
        expect(await refusal(Owners.set("e5", true, by))).toBe("OWNER_NOT_ADMIN")
        await db.query(`UPDATE "User" SET "actingUntil" = NULL, "returnRoleId" = NULL WHERE id = 'e5'`)
        expect(await refusal(Owners.set("e5", true, by))).toBe("changed")
        expect(await refusal(Owners.set("e5", false, by))).toBe("changed")
        expect(Number((await db.query(`SELECT count(*) FROM "OwnerPeriod" WHERE "userId" IN ('e4', 'e5')`)).rows[0].count)).toBe(0)
    })

    it("keeps an owner's role Admin, and changes it once they're not one", async () => {
        const { UserService } = await import("@/lib/services/user.service")
        const employeeRole = (await db.query(`SELECT id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)).rows[0].id
        const roleOf = async (id: string) => (await db.query(`SELECT role FROM "User" WHERE id = $1`, [id])).rows[0].role
        expect(await refusal(UserService.update({ id: "e3", roleId: employeeRole }, superAdmin))).toBe("OWNER_STAYS_ADMIN")
        expect(await roleOf("e3")).toBe("ADMIN")
        await Owners.set("e3", false, by)
        expect(await refusal(UserService.update({ id: "e3", roleId: employeeRole }, superAdmin))).toBe("changed")
        expect(await roleOf("e3")).toBe("EMPLOYEE")
    })

    it("refuses marking someone while a repeating obligation of theirs is still to make its next one, until it's made and moved", async () => {
        const { ObligationService } = await import("@/lib/services/obligation.service")
        const { OwnerRefused } = await import("@/lib/services/owner.service")
        const done = async (id: string, recurrence: string) => db.query(
            `INSERT INTO "Obligation"(id, title, description, recurrence, deadline, status, "companyId", "updatedAt") VALUES ($1, $1, 'Made up', $2, $3, 'COMPLETED', 'c1', now())`,
            [id, recurrence, inDays(-1)])
        await done("Made-up monthly filing", "MONTHLY")
        await done("Made-up one-off filing", "ONE_TIME")
        await db.query(`INSERT INTO "_ObligationAssignees"("A", "B") VALUES ('Made-up monthly filing', 'e1'), ('Made-up one-off filing', 'e1')`)

        const workOf = async () => {
            try {
                await Owners.set("e1", true, by)
                return "changed"
            } catch (error) {
                expect(error).toBeInstanceOf(OwnerRefused)
                return (error as InstanceType<typeof OwnerRefused>).work.map(w => [w.kind, w.title])
            }
        }
        expect(await workOf()).toEqual([["repeating", "Made-up monthly filing"]])

        // Made overnight, it's open work, theirs until it's moved.
        await ObligationService.processRecurrentObligations()
        const next = (await obligationsOf("e1")).find(o => o.status === "PENDING")!
        expect(await workOf()).toEqual([["obligation", "Made-up monthly filing"]])
        await ObligationService.update(next.id, { assigneeIds: ["e2"] }, admin)
        expect(await workOf()).toBe("changed")

        // The overnight run gives an owner no next one either: one deleted
        // is made again for the others on it, and with only owners, not at all.
        await db.query(`DELETE FROM "Obligation" WHERE id = $1`, [next.id])
        await done("Made-up shared filing", "WEEKLY")
        await db.query(`INSERT INTO "_ObligationAssignees"("A", "B") VALUES ('Made-up shared filing', 'e1'), ('Made-up shared filing', 'e2')`)
        await ObligationService.processRecurrentObligations()
        const made = (await db.query(
            `SELECT o.title, array_agg(a."B" ORDER BY a."B") AS people FROM "Obligation" o JOIN "_ObligationAssignees" a ON a."A" = o.id WHERE o.status = 'PENDING' GROUP BY o.id, o.title ORDER BY o.title`)).rows
        expect(made).toEqual([{ title: "Made-up shared filing", people: ["e2"] }])
    })
})
