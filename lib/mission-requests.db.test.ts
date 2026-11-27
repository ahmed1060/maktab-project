import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * Missions asked for and decided, against a real Postgres built from the
 * migrations (ATTENDANCE_PLAN.md §6.10, round 10, decisions 4, 10, 11, 16,
 * 18, 20 and 25, PR 283): what asking refuses and what it keeps; a day off
 * asked over a mission; withdrawing one while it waits; deciding one, the
 * asker told and the days worked out again, a closed month's becoming
 * discrepancies; the Requests page's feed; and payroll's count of those
 * waiting.
 *
 * The clock is held at 10:00 on Saturday 14 November 2026 in Cairo. The
 * office works Sunday to Thursday, 09:00–17:00, with an hour's break.
 * October's payroll is approved, with attendance, and Ehab was absent on
 * Thursday 29 October, attendance starting with Eman's first scan on the
 * 1st. From 1 December the policy has missions off.
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
 ('l1', 'l1@x', 'p', 'Laila', 'Lead', 'TEAM_LEADER', 2026, 'l1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', 'l1'),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL),
 ('x1', 'x1@x', 'p', 'Ziad', 'Two', 'EMPLOYEE', 2026, 'x1', 'c2', NULL);
`

const NOW = new Date("2026-11-14T08:00:00Z")

describe.skipIf(!ADMIN_URL)("missions asked for and decided, in Postgres", () => {
    const dbName = `mission_requests_test_${Date.now()}`
    let db: Client
    let Missions: typeof import("@/lib/services/mission-request.service").MissionRequestService

    const task = async (id: string, companyId: string, status: string, assignee: string) => {
        await db.query(`INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "updatedAt") VALUES ($1, $2, 'd', $3, now(), $4, now())`, [id, `Task ${id}`, status, companyId])
        await db.query(`INSERT INTO "_MultipleAssignees"("A", "B") VALUES ($1, $2)`, [id, assignee])
    }
    const mission = async (id: string) => (await db.query(`SELECT * FROM "MissionRequest" WHERE id = $1`, [id])).rows[0]
    const day = async (userId: string, date: string) => (await db.query(`SELECT * FROM "AttendanceDay" WHERE "userId" = $1 AND date = $2`, [userId, date])).rows[0]
    const audit = async (id: string) => (await db.query(`SELECT action FROM "AuditLog" WHERE "entityId" = $1 ORDER BY action`, [id])).rows.map(r => r.action)
    const told = async (id: string) => (await db.query(`SELECT type, "messageKey", "messageParams", "userId" FROM "Notification" WHERE "relatedId" = $1`, [id])).rows
    const clear = () => db.query(`DELETE FROM "MissionRequest"; DELETE FROM "DayOffRequest"`)
    const byDays = (startDate: string, endDate: string, reason = "Client visit") => ({ kind: "DAYS" as const, startDate, endDate, reason })

    beforeAll(async () => {
        vi.useFakeTimers({ toFake: ["Date"], now: NOW })
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`CREATE DATABASE ${dbName}`)
        await admin.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Missions = (await import("@/lib/services/mission-request.service")).MissionRequestService
        const { AttendanceCalendarService: Calendar } = await import("@/lib/services/attendance-calendar.service")
        const { AttendancePolicyService: Policy } = await import("@/lib/services/attendance-policy.service")
        const { AttendanceEngineService: Engine } = await import("@/lib/services/attendance-engine.service")

        // 9,300.00 a month.
        await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES ('s1', 'e1', 9300, '2026-01-01T00:00:00Z'), ('s2', 'e2', 9300, '2026-01-01T00:00:00Z')`)
        await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: "2026-10-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-10-01", body: STANDARD_OFFICE }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-12-01", body: { ...STANDARD_OFFICE, missions: { enabled: false } } }, "a1")
        // October worked out, then paid with attendance: Ehab absent on Thursday the 29th.
        // Attendance starts with the company's first scan: Eman's on 1 October.
        const { AttendancePunchService: Punches } = await import("@/lib/services/attendance-punch.service")
        await Punches.addManual("c1", { userId: "e2", at: "2026-10-01T09:00", direction: null, note: "terminal down" }, "a1")
        await Engine.recomputeFrom("c1", "2026-10-01", ["e1"])
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", year, month, status, "payrollDay", "attendanceIncluded", "updatedAt") VALUES ('run10', 'c1', 2026, 10, 'APPROVED', 25, true, now())`)
        await db.query(`UPDATE "AttendanceDay" SET "lockedByPayrollRunId" = 'run10' WHERE "companyId" = 'c1' AND date < '2026-11-01'`)
        // Ehab's open tasks, and what isn't.
        await task("t-open", "c1", "IN_PROGRESS", "e1")
        await task("t-new", "c1", "PENDING", "e1")
        await task("t-done", "c1", "COMPLETED", "e1")
        await task("t-eman", "c1", "IN_PROGRESS", "e2")
        await task("t-other", "c2", "IN_PROGRESS", "x1")
    }, 180_000)

    afterAll(async () => {
        vi.useRealTimers()
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await admin.end()
    })

    describe("asking", () => {
        it("keeps a mission by days or by hours, for oneself, with one of their open tasks and its title, in the audit log", async () => {
            const a = await Missions.ask("c1", "e1", { kind: "DAYS", startDate: "2026-11-16", endDate: "2026-11-18", taskId: "t-open", reason: " Site survey " })
            expect(await mission(a.id)).toMatchObject({ userId: "e1", companyId: "c1", kind: "DAYS", hoursPart: null, taskId: "t-open", taskTitle: "Task t-open", reason: "Site survey", status: "PENDING" })
            expect((await mission(a.id)).startDate.toISOString().slice(0, 10)).toBe("2026-11-16")
            expect((await mission(a.id)).endDate.toISOString().slice(0, 10)).toBe("2026-11-18")
            const b = await Missions.ask("c1", "e1", { kind: "HOURS", startDate: "2026-11-19", hoursPart: "FROM_START", reason: "Bank" })
            expect(await mission(b.id)).toMatchObject({ kind: "HOURS", hoursPart: "FROM_START", taskId: null, taskTitle: null })
            expect((await mission(b.id)).endDate.toISOString().slice(0, 10)).toBe("2026-11-19")
            expect(await audit(a.id)).toEqual(["REQUEST_ATTENDANCE_MISSION"])
            await clear()
        })

        it("offers their open tasks alone: theirs, Pending or In progress, in their company", async () => {
            expect((await Missions.openTasks("c1", "e1")).map(t => t.id).sort()).toEqual(["t-new", "t-open"])
            expect(await Missions.openTasks("c1", "e2")).toEqual([{ id: "t-eman", title: "Task t-eman" }])
        })

        it("refuses a task that isn't one of their open ones", async () => {
            for (const taskId of ["t-done", "t-eman", "t-other", "nope"]) {
                await expect(Missions.ask("c1", "e1", { ...byDays("2026-11-16", "2026-11-16"), taskId }), taskId).rejects.toThrow("MISSION_TASK_NOT_OPEN")
            }
        })

        it("refuses one without a reason, or with dates it can't have", async () => {
            await expect(Missions.ask("c1", "e1", byDays("2026-11-16", "2026-11-16", "  "))).rejects.toThrow("REASON_REQUIRED")
            await expect(Missions.ask("c1", "e1", byDays("2026-11-18", "2026-11-16"))).rejects.toThrow("MISSION_DATES_INVALID")
            await expect(Missions.ask("c1", "e1", { kind: "HOURS", startDate: "2026-11-16", reason: "Bank" })).rejects.toThrow("MISSION_DATES_INVALID")
            await expect(Missions.ask("c1", "e1", byDays("2026-11-01", "2027-01-30"))).rejects.toThrow("MISSION_TOO_LONG")
            await expect(Missions.ask("c1", "e1", byDays("2025-11-01", "2025-11-02"))).rejects.toThrow("MISSION_OUT_OF_RANGE")
        })

        it("refuses one while any of its dates falls under a policy with missions off (decision 11)", async () => {
            await expect(Missions.ask("c1", "e1", byDays("2026-11-30", "2026-12-01"))).rejects.toThrow("MISSIONS_OFF")
            expect(await Missions.missionsOnToday("c1")).toBe(true)
            const { rows: [n] } = await db.query(`SELECT count(*)::int AS n FROM "MissionRequest"`)
            expect(n.n).toBe(0)
        })

        it("refuses one over another mission waiting or approved, but not over one rejected or withdrawn (decision 10)", async () => {
            const first = await Missions.ask("c1", "e1", byDays("2026-11-16", "2026-11-18"))
            await expect(Missions.ask("c1", "e1", { kind: "HOURS", startDate: "2026-11-18", hoursPart: "TO_END", reason: "Bank" })).rejects.toThrow("MISSION_OVERLAPS")
            await db.query(`UPDATE "MissionRequest" SET status = 'APPROVED' WHERE id = $1`, [first.id])
            await expect(Missions.ask("c1", "e1", byDays("2026-11-12", "2026-11-16"))).rejects.toThrow("MISSION_OVERLAPS")
            // Someone else's dates are theirs.
            await Missions.ask("c1", "e2", byDays("2026-11-16", "2026-11-18"))
            await db.query(`UPDATE "MissionRequest" SET status = 'REJECTED' WHERE id = $1`, [first.id])
            await Missions.ask("c1", "e1", byDays("2026-11-17", "2026-11-17"))
            await clear()
        })

        it("refuses one over a day off waiting or approved, but not over one rejected (decision 10)", async () => {
            await db.query(`INSERT INTO "DayOffRequest"(id, "userId", type, date, "endDate", status, "updatedAt") VALUES ('d1', 'e1', 'REGULAR', '2026-11-22', '2026-11-24', 'APPROVED', now()), ('d2', 'e1', 'CASUAL', '2026-11-26', NULL, 'PENDING', now()), ('d3', 'e1', 'REGULAR', '2026-11-29', NULL, 'REJECTED', now())`)
            await expect(Missions.ask("c1", "e1", byDays("2026-11-24", "2026-11-25"))).rejects.toThrow("MISSION_OVERLAPS_DAY_OFF")
            await expect(Missions.ask("c1", "e1", { kind: "HOURS", startDate: "2026-11-26", hoursPart: "FROM_START", reason: "Bank" })).rejects.toThrow("MISSION_OVERLAPS_DAY_OFF")
            await Missions.ask("c1", "e1", byDays("2026-11-29", "2026-11-29"))
            await Missions.ask("c1", "e1", byDays("2026-11-25", "2026-11-25"))
            await clear()
        })

        it("accepts one across a month whose payroll is approved (decision 16)", async () => {
            const m = await Missions.ask("c1", "e1", byDays("2026-10-29", "2026-11-02"))
            expect((await mission(m.id)).status).toBe("PENDING")
            await clear()
        })
    })

    describe("a day off asked over a mission", () => {
        it("is refused while the mission waits or is approved, and not once it's withdrawn", async () => {
            const { DayOffService } = await import("@/lib/services/day-off.service")
            const session = { user: { id: "e1", companyId: "c1", name: "Ehab One" } }
            const m = await Missions.ask("c1", "e1", byDays("2026-11-23", "2026-11-24"))
            await expect(DayOffService.create({ date: "2026-11-22", endDate: "2026-11-23", type: "REGULAR" } as any, session)).rejects.toThrow("DAY_OFF_OVERLAPS_MISSION")
            await db.query(`UPDATE "MissionRequest" SET status = 'APPROVED' WHERE id = $1`, [m.id])
            await expect(DayOffService.create({ date: "2026-11-24", type: "CASUAL" } as any, session)).rejects.toThrow("DAY_OFF_OVERLAPS_MISSION")
            await db.query(`UPDATE "MissionRequest" SET status = 'WITHDRAWN' WHERE id = $1`, [m.id])
            await DayOffService.create({ date: "2026-11-24", type: "CASUAL" } as any, session)
            await clear()
        })
    })

    describe("withdrawing", () => {
        it("is one's own mission's, while it waits, in the audit log", async () => {
            const m = await Missions.ask("c1", "e1", byDays("2026-11-16", "2026-11-16"))
            await expect(Missions.withdraw(m.id, "e2")).rejects.toThrow("REQUEST_NOT_FOUND")
            await Missions.withdraw(m.id, "e1")
            expect((await mission(m.id)).status).toBe("WITHDRAWN")
            expect(await audit(m.id)).toEqual(["REQUEST_ATTENDANCE_MISSION", "WITHDRAW_ATTENDANCE_MISSION"])
            await expect(Missions.withdraw(m.id, "e1")).rejects.toThrow("REQUEST_ALREADY_DECIDED")
            await db.query(`UPDATE "MissionRequest" SET status = 'APPROVED' WHERE id = $1`, [m.id])
            await expect(Missions.withdraw(m.id, "e1")).rejects.toThrow("REQUEST_ALREADY_DECIDED")
            await clear()
        })
    })

    describe("deciding", () => {
        it("is never one's own, and once only", async () => {
            const m = await Missions.ask("c1", "a1", byDays("2026-11-16", "2026-11-16"))
            await expect(Missions.decide(m.id, { approve: true }, "a1")).rejects.toThrow("CANNOT_DECIDE_OWN")
            const e = await Missions.ask("c1", "e1", byDays("2026-11-16", "2026-11-16"))
            await Missions.decide(e.id, { approve: false, reason: "Not this week" }, "a1")
            await expect(Missions.decide(e.id, { approve: true }, "a1")).rejects.toThrow("REQUEST_ALREADY_DECIDED")
            await clear()
        })

        it("rejecting keeps why, and the asker hears it", async () => {
            const m = await Missions.ask("c1", "e1", byDays("2026-11-16", "2026-11-18"))
            await Missions.decide(m.id, { approve: false, reason: " Not this week " }, "a1")
            expect(await mission(m.id)).toMatchObject({ status: "REJECTED", reviewedById: "a1", rejectionReason: "Not this week" })
            expect(await audit(m.id)).toEqual(["REJECT_ATTENDANCE_MISSION", "REQUEST_ATTENDANCE_MISSION"])
            const [notice] = await told(m.id)
            expect(notice).toMatchObject({ type: "ATTENDANCE_REQUEST", userId: "e1", messageKey: "notice_att_mission_rejected" })
            expect(notice.messageParams.when).toMatchObject({ key: "notice_mission_days" })
            expect(JSON.stringify(notice.messageParams.reason)).toContain("Not this week")
            await clear()
        })

        it("approving tells the asker, and works the mission's days out again", async () => {
            const m = await Missions.ask("c1", "e1", { kind: "HOURS", startDate: "2026-11-12", hoursPart: "TO_END", reason: "Bank" })
            await Missions.decide(m.id, { approve: true }, "a1")
            expect(await mission(m.id)).toMatchObject({ status: "APPROVED", reviewedById: "a1", rejectionReason: null })
            const [notice] = await told(m.id)
            expect(notice).toMatchObject({ userId: "e1", messageKey: "notice_att_mission_approved" })
            expect(notice.messageParams.when).toMatchObject({ key: "notice_mission_day" })
            // No scan on a mission by hours: still absent, but read with it.
            expect((await day("e1", "2026-11-12")).breakdown).toMatchObject({ mission: "TO_END" })
            await clear()
        })

        it("approving one across a closed month makes its days there discrepancies, and counts the open month's (decision 16)", async () => {
            expect(await day("e1", "2026-10-29")).toMatchObject({ status: "ABSENT" })
            const paid = (await day("e1", "2026-10-29")).deductionMinor
            expect(paid).toBeGreaterThan(0)
            const m = await Missions.ask("c1", "e1", byDays("2026-10-29", "2026-11-02"))
            await Missions.decide(m.id, { approve: true }, "a1")
            const { rows } = await db.query(`SELECT * FROM "AttendanceDiscrepancy" WHERE "userId" = 'e1' AND date = '2026-10-29'`)
            expect(rows).toHaveLength(1)
            expect(rows[0]).toMatchObject({ payrollRunId: "run10", paidDeductionMinor: paid, nowDeductionMinor: 0, nowStatus: "MISSION", resolvedAt: null })
            // What was paid isn't rewritten.
            expect(await day("e1", "2026-10-29")).toMatchObject({ status: "ABSENT", deductionMinor: paid })
            expect(await day("e1", "2026-11-01")).toMatchObject({ status: "MISSION", deductionMinor: 0 })
            expect(await day("e1", "2026-11-02")).toMatchObject({ status: "MISSION" })
            await clear()
        })

        it("approving one whose days have since passed the year the engine reworks by itself still works them out again (found by Codex on PR 283)", { timeout: 120_000 }, async () => {
            const paid = (await day("e1", "2026-10-28")).deductionMinor
            expect(paid).toBeGreaterThan(0)
            const m = await Missions.ask("c1", "e1", byDays("2026-10-28", "2026-10-28"))
            // Decided a year on, when the engine's own reworking starts at November 2026.
            vi.setSystemTime(new Date("2027-11-02T08:00:00Z"))
            try {
                await Missions.decide(m.id, { approve: true }, "a1")
            } finally {
                vi.setSystemTime(NOW)
            }
            const { rows } = await db.query(`SELECT * FROM "AttendanceDiscrepancy" WHERE "userId" = 'e1' AND date = '2026-10-28'`)
            expect(rows).toHaveLength(1)
            expect(rows[0]).toMatchObject({ payrollRunId: "run10", paidDeductionMinor: paid, nowDeductionMinor: 0, nowStatus: "MISSION" })
            // The days that clock reached, gone again for the tests after.
            await db.query(`DELETE FROM "AttendanceDay" WHERE "userId" = 'e1' AND date >= '2026-11-14'`)
            await clear()
        })
    })

    describe("cancelling an approved mission (decision 25, PR 285)", () => {
        it("is an approved one's alone, by somebody else, with a reason; the asker hears why, and it's in the audit log", async () => {
            const m = await Missions.ask("c1", "e1", byDays("2026-11-16", "2026-11-17"))
            // One waiting is rejected or withdrawn instead.
            await expect(Missions.cancel(m.id, "Trip called off", "a1")).rejects.toThrow("MISSION_NOT_APPROVED")
            await Missions.decide(m.id, { approve: true }, "a1")
            await expect(Missions.cancel(m.id, "  ", "a1")).rejects.toThrow("REASON_REQUIRED")
            await expect(Missions.cancel(m.id, "Mine", "e1")).rejects.toThrow("CANNOT_DECIDE_OWN")
            await expect(Missions.cancel("none", "Trip called off", "a1")).rejects.toThrow("REQUEST_NOT_FOUND")
            expect(await mission(m.id)).toMatchObject({ status: "APPROVED", cancelledById: null, cancelReason: null })

            await Missions.cancel(m.id, " Trip called off ", "a1")
            const cancelled = await mission(m.id)
            expect(cancelled).toMatchObject({ status: "CANCELLED", cancelledById: "a1", cancelReason: "Trip called off", reviewedById: "a1" })
            expect(cancelled.cancelledAt).toBeInstanceOf(Date)
            expect(await audit(m.id)).toEqual(["APPROVE_ATTENDANCE_MISSION", "CANCEL_ATTENDANCE_MISSION", "REQUEST_ATTENDANCE_MISSION"])
            const notice = (await told(m.id)).find(n => n.messageKey === "notice_att_mission_cancelled")
            expect(notice).toMatchObject({ type: "ATTENDANCE_REQUEST", userId: "e1" })
            expect(notice.messageParams.when).toMatchObject({ key: "notice_mission_days" })
            expect(JSON.stringify(notice.messageParams.reason)).toContain("Trip called off")
            // Once only.
            await expect(Missions.cancel(m.id, "Again", "a1")).rejects.toThrow("MISSION_NOT_APPROVED")
            await clear()
        })

        it("has its days count again as they would without it", async () => {
            const m = await Missions.ask("c1", "e1", byDays("2026-11-12", "2026-11-12"))
            await Missions.decide(m.id, { approve: true }, "a1")
            expect(await day("e1", "2026-11-12")).toMatchObject({ status: "MISSION", deductionMinor: 0 })
            await Missions.cancel(m.id, "Didn't go", "a1")
            const after = await day("e1", "2026-11-12")
            expect(after.status).toBe("ABSENT")
            expect(after.deductionMinor).toBeGreaterThan(0)
            expect(after.breakdown).not.toHaveProperty("mission")
            await clear()
        })

        it("frees its dates for another mission, or a day off", async () => {
            const m = await Missions.ask("c1", "e1", byDays("2026-11-16", "2026-11-17"))
            await Missions.decide(m.id, { approve: true }, "a1")
            await expect(Missions.ask("c1", "e1", byDays("2026-11-17", "2026-11-18"))).rejects.toThrow("MISSION_OVERLAPS")
            await Missions.cancel(m.id, "Trip called off", "a1")
            expect((await Missions.ask("c1", "e1", byDays("2026-11-17", "2026-11-18"))).status).toBe("PENDING")
            await clear()
        })

        it("in a month whose payroll is approved, closes the discrepancy approving it opened: the day is back to what was paid", async () => {
            const paid = (await day("e1", "2026-10-27")).deductionMinor
            expect(paid).toBeGreaterThan(0)
            const open = async () => (await db.query(`SELECT * FROM "AttendanceDiscrepancy" WHERE "userId" = 'e1' AND date = '2026-10-27' AND "resolvedAt" IS NULL`)).rows
            const m = await Missions.ask("c1", "e1", byDays("2026-10-27", "2026-10-27"))
            await Missions.decide(m.id, { approve: true }, "a1")
            expect(await open()).toMatchObject([{ paidDeductionMinor: paid, nowDeductionMinor: 0, nowStatus: "MISSION" }])
            await Missions.cancel(m.id, "Didn't go", "a1")
            expect(await open()).toEqual([])
            // What was paid isn't rewritten.
            expect(await day("e1", "2026-10-27")).toMatchObject({ status: "ABSENT", deductionMinor: paid })
            await clear()
        })

        it("and once that one was settled, opens a new one the other way round: the deduction charged", async () => {
            const paid = (await day("e1", "2026-10-26")).deductionMinor
            expect(paid).toBeGreaterThan(0)
            const m = await Missions.ask("c1", "e1", byDays("2026-10-26", "2026-10-26"))
            await Missions.decide(m.id, { approve: true }, "a1")
            // HR settles it on the next payslip: the deduction refunded.
            await db.query(`UPDATE "AttendanceDiscrepancy" SET "resolvedAt" = now(), "resolvedById" = 'a1', resolution = 'Refunded' WHERE "userId" = 'e1' AND date = '2026-10-26'`)
            await Missions.cancel(m.id, "Didn't go", "a1")
            const { rows } = await db.query(`SELECT * FROM "AttendanceDiscrepancy" WHERE "userId" = 'e1' AND date = '2026-10-26' ORDER BY "resolvedAt" NULLS LAST`)
            expect(rows).toHaveLength(2)
            expect(rows[0]).toMatchObject({ paidDeductionMinor: paid, nowDeductionMinor: 0, nowStatus: "MISSION", resolution: "Refunded" })
            expect(rows[1]).toMatchObject({ resolvedAt: null, paidDeductionMinor: 0, paidStatus: "MISSION", nowDeductionMinor: paid, nowStatus: "ABSENT" })
            await clear()
        })
    })

    describe("on the Requests page", () => {
        const q = { show: "waiting" as const, kind: "mission" as const, search: "", personId: "", companyId: null, page: 1, limit: 10 }

        it("is cancelled from To review's Done by whoever decides it, and is then Cancelled for both, with why (PR 285)", { timeout: 60_000 }, async () => {
            const { requestFeed } = await import("@/lib/requests/feed")
            const m = await Missions.ask("c1", "e1", byDays("2026-11-18", "2026-11-19"))
            await Missions.decide(m.id, { approve: true }, "a1")
            const ehab = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" })
            const amal = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
            const done = { ...q, show: "done" as const }
            expect((await requestFeed(amal, { ...done, tab: "review" })).rows.find(r => r.id === m.id)).toMatchObject({ status: "APPROVED", mayCancel: true })
            expect((await requestFeed(ehab, { ...done, tab: "mine" })).rows.find(r => r.id === m.id)).toMatchObject({ status: "APPROVED", mayCancel: false })
            await Missions.cancel(m.id, "Trip called off", "a1")
            for (const [who, tab] of [[amal, "review"], [ehab, "mine"]] as const) {
                expect((await requestFeed(who, { ...done, tab })).rows.find(r => r.id === m.id), tab)
                    .toMatchObject({ status: "CANCELLED", mayCancel: false, mission: { cancelReason: "Trip called off" } })
            }
            await clear()
        })

        it("are the asker's on Mine, and on To review for whoever decides them, with the scans so far", { timeout: 60_000 }, async () => {
            const { requestFeed } = await import("@/lib/requests/feed")
            const { AttendancePunchService: Punches } = await import("@/lib/services/attendance-punch.service")
            await Punches.addManual("c1", { userId: "e1", at: "2026-11-10T09:05", direction: null, note: "terminal down" }, "a1")
            await Punches.addManual("c1", { userId: "e1", at: "2026-11-10T13:00", direction: null, note: "terminal down" }, "a1")
            const m = await Missions.ask("c1", "e1", { kind: "DAYS", startDate: "2026-11-10", endDate: "2026-11-11", taskId: "t-open", reason: "Client visit" })

            const ehab = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" })
            const mine = await requestFeed(ehab, { ...q, tab: "mine" })
            expect(mine.rows.map(r => r.id)).toEqual([m.id])
            expect(mine.rows[0]).toMatchObject({ kind: "mission", mayDecide: false, mayWithdraw: true, mission: { task: "Task t-open", scans: null } })
            expect(mine.kinds).toContain("mission")

            const amal = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
            const review = await requestFeed(amal, { ...q, tab: "review" })
            expect(review.rows.map(r => r.id)).toEqual([m.id])
            expect(review.rows[0]).toMatchObject({
                who: { id: "e1", name: "Ehab One" }, what: "DAYS", mayDecide: true, mayWithdraw: false,
                mission: { from: "2026-11-10", to: "2026-11-11", scans: [{ date: "2026-11-10", times: ["09:05", "13:00"] }] },
            })
            // The built-in Team Leader decides none.
            const laila = withGrants({ id: "l1", role: "TEAM_LEADER", companyId: "c1" })
            expect((await requestFeed(laila, { ...q, tab: "review" })).rows).toEqual([])
            await clear()
        })

        it("give every scan on each mission shown, read for the page shown alone (found by Codex on PR 283)", { timeout: 60_000 }, async () => {
            const { requestFeed } = await import("@/lib/requests/feed")
            // Eman's 90 days, with a scan an hour for 2,100 hours of them: more than one read for the page once stopped at.
            const long = await Missions.ask("c1", "e2", byDays("2026-08-20", "2026-11-17"))
            await db.query(`
                INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone")
                SELECT 'bulk-' || g, 'c1', 'e2', 'MANUAL', 'bulk-' || g, timestamp '2026-08-20 08:00' + g * interval '1 hour',
                    timestamp '2026-08-20 05:00' + g * interval '1 hour', 'Africa/Cairo'
                FROM generate_series(0, 2099) g`)
            const short = await Missions.ask("c1", "e1", byDays("2026-11-20", "2026-11-20"))
            try {
                const amal = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
                const pages = [await requestFeed(amal, { ...q, tab: "review", limit: 1, page: 1 }), await requestFeed(amal, { ...q, tab: "review", limit: 1, page: 2 })]
                const rows = pages.flatMap(p => p.rows)
                expect(rows.map(r => r.id).sort()).toEqual([long.id, short.id].sort())
                const eman = rows.find(r => r.id === long.id)!
                // Those, and her scan on 1 October.
                expect(eman.mission!.scans!.reduce((n, d) => n + d.times.length, 0)).toBe(2101)
                expect(eman.mission!.scans![0]).toMatchObject({ date: "2026-08-20", times: expect.arrayContaining(["08:00", "09:00"]) })
                expect(rows.find(r => r.id === short.id)!.mission!.scans).toEqual([])
            } finally {
                await db.query(`DELETE FROM "AttendancePunch" WHERE id LIKE 'bulk-%'`)
                await clear()
            }
        })
    })

    describe("payroll's window", () => {
        it("counts the missions waiting with a day in the month, for people on the register", async () => {
            const { daysToSettle } = await import("@/lib/services/attendance-payroll")
            const { prisma } = await import("@/lib/prisma")
            await Missions.ask("c1", "e1", byDays("2026-10-30", "2026-11-03"))
            await Missions.ask("c1", "e2", byDays("2026-11-20", "2026-11-20"))
            const decided = await Missions.ask("c1", "e2", byDays("2026-11-24", "2026-11-24"))
            await Missions.decide(decided.id, { approve: false }, "a1")
            await Missions.ask("c1", "e2", { kind: "HOURS", startDate: "2026-12-01", hoursPart: "TO_END", reason: "Bank" }).catch(() => null)
            expect((await daysToSettle(prisma, "c1", { from: "2026-11-01", to: "2026-11-30" }, ["e1", "e2"])).requests.missions).toBe(2)
            expect((await daysToSettle(prisma, "c1", { from: "2026-11-01", to: "2026-11-30" }, ["e2"])).requests.missions).toBe(1)
            expect((await daysToSettle(prisma, "c1", { from: "2026-10-01", to: "2026-10-31" }, ["e1", "e2"])).requests.missions).toBe(1)
            await clear()
        })
    })
})
