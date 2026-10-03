import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { PayrollRunService as Payroll } from "@/lib/services/payroll-run.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { reconcileEntries } from "@/lib/services/attendance-payroll"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"
import { addDays, weekdayOf } from "@/lib/attendance/calendar"

/**
 * Attendance reaching payroll, against a real Postgres built from the
 * migrations (ATTENDANCE_PLAN.md §12, Phase 1): the dry run, then the month
 * the company chooses, then approval — the last recompute, the payslip lines,
 * the entries, the locked days — in one transaction.
 *
 * September 2026, approved on 5 October. Ehab earns 9,300.00 a month: 310.00 a
 * day. He is late twice for free, then an hour late once (half a day,
 * 155.00), absent once (310.00), and works two hours' overtime nobody approves.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
`

const NOW = new Date("2026-10-05T06:00:00Z")
const SESSION = { user: { id: "a1", role: "ADMIN" } }

describe.skipIf(!ADMIN_URL)("attendance in payroll, in Postgres", () => {
    const dbName = `attpay_test_${Date.now()}`
    let db: Client

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
            if (m === "20260920000000_team_leader") await db.query(BEFORE_ROLES)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()

        await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES
            ('s1', 'e1', 9300, '2026-01-01T00:00:00Z'), ('s2', 'a1', 15000, '2026-01-01T00:00:00Z')`)
        await db.query(`INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES
            ('h1', 'e1', 'HIRED', '2026-01-01T00:00:00Z'), ('h2', 'a1', 'HIRED', '2026-01-01T00:00:00Z')`)
        await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: "2026-09-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-09-01", body: STANDARD_OFFICE }, "a1")

        // Both work every working day, 09:00–17:00, but for Ehab's listed days.
        const { rows: holidays } = await db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM "PublicHoliday" WHERE date BETWEEN '2026-09-01' AND '2026-09-30'`)
        const off = new Set(holidays.map(h => h.d))
        const special: Record<string, [string, string] | null> = {
            "2026-09-02": ["09:40", "17:00"], // late 40: free
            "2026-09-03": ["09:45", "17:00"], // late 45: free
            "2026-09-06": ["10:00", "17:00"], // late 60: half a day
            "2026-09-07": ["09:00", "19:00"], // two hours' overtime, waiting
            "2026-09-08": null,               // absent
        }
        const rows: string[][] = [["AC-No.", "Check Time"]]
        for (let d = "2026-09-01"; d <= "2026-09-30"; d = addDays(d, 1)) {
            if (![0, 1, 2, 3, 4].includes(weekdayOf(d)) || off.has(d)) continue
            const dmy = (t: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${t}`
            rows.push(["2", dmy("09:00")], ["2", dmy("17:00")])
            const mine = d in special ? special[d] : ["09:00", "17:00"]
            if (mine) rows.push(["1", dmy(mine[0])], ["1", dmy(mine[1])])
        }
        await Punches.mapCode("c1", { code: "1", userId: "e1" }, "a1")
        await Punches.mapCode("c1", { code: "2", userId: "a1" }, "e1")
        await Punches.importRows("c1", { name: "september.csv", hash: "sep", rows }, { dateOrder: "DMY" }, "a1", true)
    }, 180_000)

    afterAll(async () => {
        vi.useRealTimers()
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const ehab = (register: Awaited<ReturnType<typeof Payroll.compute>>["register"]) => register.entries.find(e => e.userId === "e1")!
    const attendanceLines = (lines: { source: string; label: string; amountMinor: number }[]) =>
        lines.filter(l => l.source === "ATTENDANCE").map(l => [l.label, l.amountMinor])

    it("before the company's chosen month, shows what attendance would cost and deducts nothing (the dry run)", async () => {
        const out = await Payroll.compute("c1", 2026, 9)
        expect(out.attendance).toMatchObject({ reachesPayroll: false, from: null })
        expect(out.attendance.byPerson.e1).toEqual({ lateness: 15500, earlyLeave: 0, absence: 31000, overtime: 0 })
        expect(attendanceLines(ehab(out.register).lines)).toEqual([])
        expect(ehab(out.register).totals.netMinor).toBe(930000)
    })

    it("from that month on, puts it on the payslip as money, one line per category", async () => {
        await db.query(`UPDATE "Company" SET "attendancePayrollFrom" = '2026-09-01' WHERE id = 'c1'`)
        const out = await Payroll.compute("c1", 2026, 9)
        expect(out.attendance.reachesPayroll).toBe(true)
        expect(attendanceLines(ehab(out.register).lines)).toEqual([["Lateness", 15500], ["Absence", 31000]])
        expect(ehab(out.register).totals.netMinor).toBe(930000 - 15500 - 31000)
    })

    it("approves in one transaction: overtime nobody decided is rejected, the days rebuilt, priced, entered and locked", async () => {
        expect((await db.query(`SELECT "overtimeStatus" FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-09-07'`)).rows[0].overtimeStatus).toBe("PENDING")
        // The day's stored row is missing — a punch landed but its recompute
        // failed. Approval rebuilds before it refuses what waits (review on #16).
        await db.query(`DELETE FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-09-07'`)
        // The switch is being turned on, not yet committed, as approval starts:
        // approval waits for it and uses it throughout (review on #16).
        await db.query(`UPDATE "Company" SET "attendancePayrollFrom" = NULL WHERE id = 'c1'`)
        await db.query("BEGIN")
        await db.query(`UPDATE "Company" SET "attendancePayrollFrom" = '2026-09-01' WHERE id = 'c1'`)
        const approving = Payroll.approve("c1", 2026, 9, SESSION)
        await new Promise(r => setTimeout(r, 1500))
        await db.query("COMMIT")
        const result = await approving
        expect(result).toHaveProperty("runId")
        const runId = (result as { runId: string }).runId

        const { rows: [ot] } = await db.query(`SELECT status, "decidedById" FROM "OvertimeApproval" WHERE "userId" = 'e1' AND date = '2026-09-07'`)
        expect(ot).toEqual({ status: "REJECTED", decidedById: "a1" })
        expect((await db.query(`SELECT "overtimeStatus" FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-09-07'`)).rows[0].overtimeStatus).toBe("REJECTED")

        const { rows: entries } = await db.query(`SELECT category, "amountMinor", "payrollRunId" FROM "AttendancePayrollEntry" WHERE "userId" = 'e1' ORDER BY category`)
        // In the enum's order.
        expect(entries).toEqual([
            { category: "LATENESS", amountMinor: 15500, payrollRunId: runId },
            { category: "ABSENCE", amountMinor: 31000, payrollRunId: runId },
        ])
        const { rows: lines } = await db.query(`SELECT l.label, l.amount::text FROM "PayslipLine" l JOIN "Payslip" p ON p.id = l."payslipId" WHERE p."userId" = 'e1' AND l.source = 'ATTENDANCE' ORDER BY l."sortOrder"`)
        expect(lines).toEqual([{ label: "Lateness", amount: "155.00" }, { label: "Absence", amount: "310.00" }])

        const { rows: [days] } = await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE "lockedByPayrollRunId" = $1)::int AS locked FROM "AttendanceDay" WHERE date BETWEEN '2026-09-01' AND '2026-09-30'`, [runId])
        expect(days.n).toBeGreaterThan(50)
        expect(days.locked).toBe(days.n)
        expect((await db.query(`SELECT status, "attendanceIncluded" FROM "PayrollRun" WHERE id = $1`, [runId])).rows[0]).toEqual({ status: "APPROVED", attendanceIncluded: true })
    })

    it("then holds the month: nothing changes its attendance, and approving again is refused", async () => {
        await expect(Punches.addManual("c1", { userId: "e1", at: "2026-09-08T09:00", direction: "IN", note: "late correction" }, "a1")).rejects.toThrow("PAYROLL_MONTH_LOCKED")
        expect(await Payroll.approve("c1", 2026, 9, SESSION)).toHaveProperty("refusal")
    })

    it("lets the chosen month move only past the last approved payroll, never across a paid one", async () => {
        const { AttendancePolicyService: P } = await import("@/lib/services/attendance-policy.service")
        expect(await P.payrollFrom("c1")).toEqual({ from: "2026-09", earliest: "2026-10" })
        await expect(P.setPayrollFrom("c1", "2026-09", "a1")).rejects.toThrow("ATTENDANCE_PAYROLL_MONTH_PAID")
        await expect(P.setPayrollFrom("c1", "2026-08", "a1")).rejects.toThrow("ATTENDANCE_PAYROLL_MONTH_PAID")
        expect(await P.setPayrollFrom("c1", "2026-11", "a1")).toEqual({ from: "2026-11", earliest: "2026-10" })
        expect(await P.setPayrollFrom("c1", null, "a1")).toEqual({ from: null, earliest: "2026-10" })
        // An approval of October in progress holds the company row: the change
        // waits for it, then sees October approved (review on #16).
        await db.query("BEGIN")
        await db.query(`SELECT id FROM "Company" WHERE id = 'c1' FOR SHARE`)
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", year, month, status, "payrollDay", "updatedAt") VALUES ('oct', 'c1', 2026, 10, 'APPROVED', 25, now())`)
        const setting = P.setPayrollFrom("c1", "2026-10", "a1").then(() => "set", e => e.message)
        await new Promise(r => setTimeout(r, 1000))
        await db.query("COMMIT")
        expect(await setting).toBe("ATTENDANCE_PAYROLL_MONTH_PAID")
        await db.query(`DELETE FROM "PayrollRun" WHERE id = 'oct'`)
        // September stays a month that carried attendance, whatever the setting says now.
        expect((await db.query(`SELECT "attendanceIncluded" FROM "PayrollRun" WHERE "companyId" = 'c1'`)).rows[0].attendanceIncluded).toBe(true)
        // And its register still shows it so (review on #16).
        const viewed = await Payroll.view("c1", 2026, 9)
        expect(attendanceLines(ehab(viewed.register).lines)).toEqual([["Lateness", 15500], ["Absence", 31000]])
        expect(viewed.attendance.reachesPayroll).toBe(true)
        await P.setPayrollFrom("c1", "2026-10", "a1")
    })

    it("reconciles entries rather than appending: writing the same again changes nothing, a category gone is removed", async () => {
        const { prisma } = await import("@/lib/prisma")
        const { rows: [run] } = await db.query(`SELECT id FROM "PayrollRun" WHERE "companyId" = 'c1'`)
        const people = [{ userId: "e1", excluded: false, attendance: { lateness: 15500, earlyLeave: 0, absence: 31000, overtime: 0 } }]
        expect(await prisma.$transaction(tx => reconcileEntries(tx, "c1", 2026, 9, run.id, people))).toEqual({ written: 0, removed: 0 })
        const fewer = [{ userId: "e1", excluded: false, attendance: { lateness: 15500, earlyLeave: 0, absence: 0, overtime: 0 } }]
        expect(await prisma.$transaction(tx => reconcileEntries(tx, "c1", 2026, 9, run.id, fewer))).toEqual({ written: 0, removed: 1 })
        expect((await db.query(`SELECT count(*)::int AS n FROM "AttendancePayrollEntry" WHERE "userId" = 'e1'`)).rows[0].n).toBe(1)
    })

    it("keeps each company's entries its own, for somebody paid by two in one month (review on #16)", async () => {
        const { prisma } = await import("@/lib/prisma")
        const { rows: [run] } = await db.query(`SELECT id FROM "PayrollRun" WHERE "companyId" = 'c1'`)
        await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c2', 'Two', now())`)
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", year, month, status, "payrollDay", "updatedAt") VALUES ('c2run', 'c2', 2026, 9, 'APPROVED', 25, now())`)
        await db.query(`INSERT INTO "AttendancePayrollEntry"(id, "companyId", "userId", year, month, category, "amountMinor", "payrollRunId", "updatedAt") VALUES ('c2e', 'c2', 'e1', 2026, 9, 'ABSENCE', 5000, 'c2run', now())`)
        const people = [{ userId: "e1", excluded: false, attendance: { lateness: 15500, earlyLeave: 0, absence: 31000, overtime: 0 } }]
        expect(await prisma.$transaction(tx => reconcileEntries(tx, "c1", 2026, 9, run.id, people))).toEqual({ written: 1, removed: 0 })
        const { rows } = await db.query(`SELECT "companyId", category, "amountMinor", "payrollRunId" FROM "AttendancePayrollEntry" WHERE "userId" = 'e1' ORDER BY "companyId", category`)
        expect(rows).toEqual([
            { companyId: "c1", category: "LATENESS", amountMinor: 15500, payrollRunId: run.id },
            { companyId: "c1", category: "ABSENCE", amountMinor: 31000, payrollRunId: run.id },
            { companyId: "c2", category: "ABSENCE", amountMinor: 5000, payrollRunId: "c2run" },
        ])
        await db.query(`DELETE FROM "Company" WHERE id = 'c2'`)
    })

    it("is recorded beside what was paid, never rewritten, and closes if undone (§12.3)", async () => {
        const { AttendanceEngineService: Engine } = await import("@/lib/services/attendance-engine.service")
        const { AttendanceDiscrepancyService: Discrepancies } = await import("@/lib/services/attendance-discrepancy.service")
        const { prisma } = await import("@/lib/prisma")
        // Leave approved for Ehab's absence on the 8th, after the month was paid.
        await prisma.dayOffRequest.create({ data: { id: "late-leave", userId: "e1", type: "REGULAR", status: "APPROVED", date: new Date("2026-09-08T00:00:00Z") } })
        expect(await Engine.recomputeMonth("c1", "2026-09")).toMatchObject({ locked: true, discrepancies: 1 })
        const [d] = (await Discrepancies.list("c1")).open
        expect(d).toMatchObject({ userId: "e1", date: "2026-09-08", paidDeductionMinor: 31000, nowDeductionMinor: 0, paidStatus: "ABSENT", nowStatus: "LEAVE", differenceMinor: 31000, resolvedAt: null })
        // Listed on the register even once attendance has stopped reaching payroll (review on #16).
        await db.query(`UPDATE "Company" SET "attendancePayrollFrom" = NULL WHERE id = 'c1'`)
        expect((await Payroll.view("c1", 2026, 9)).attendance.discrepanciesOpen).toBe(1)
        await db.query(`UPDATE "Company" SET "attendancePayrollFrom" = '2026-10-01' WHERE id = 'c1'`)
        // The paid day is as it was.
        expect(await prisma.attendanceDay.findFirst({ where: { userId: "e1", date: new Date("2026-09-08T00:00:00Z") }, select: { status: true, deductionMinor: true } })).toEqual({ status: "ABSENT", deductionMinor: 31000 })

        // Withdrawn before anybody acted: nothing left to settle.
        await prisma.dayOffRequest.delete({ where: { id: "late-leave" } })
        await Engine.recomputeMonth("c1", "2026-09")
        expect(await Discrepancies.list("c1")).toMatchObject({ open: [], openCount: 0, resolved: [] })

        // Approved again, settled, then changed again: open once more.
        await prisma.dayOffRequest.create({ data: { id: "late-leave", userId: "e1", type: "REGULAR", status: "APPROVED", date: new Date("2026-09-08T00:00:00Z") } })
        await Engine.recomputeMonth("c1", "2026-09")
        const [open] = (await Discrepancies.list("c1")).open
        await expect(Discrepancies.resolve(open.id, " ", "a1", false)).rejects.toThrow("REASON_REQUIRED")
        await Discrepancies.resolve(open.id, "Refunded 310.00 in October", "a1", false)
        await expect(Discrepancies.resolve(open.id, "again", "a1", false)).rejects.toThrow("DISCREPANCY_ALREADY_RESOLVED")
        expect((await Discrepancies.list("c1")).resolved[0]).toMatchObject({ resolution: "Refunded 310.00 in October", resolvedById: "a1" })
        await Engine.recomputeMonth("c1", "2026-09")
        expect((await Discrepancies.list("c1")).resolved[0].resolvedAt).not.toBeNull()
        await prisma.salaryChange.create({ data: { id: "back", userId: "e1", monthlyAmount: 12000, effectiveFrom: new Date("2026-08-31T21:00:00Z") } })
        await Engine.recomputeMonth("c1", "2026-09")
        const after = await Discrepancies.list("c1")
        expect(after.open.length).toBeGreaterThan(0)
    })

    it("measures a change after a settlement from what was settled, keeping the settlement (review on #16)", async () => {
        const { AttendanceEngineService: Engine } = await import("@/lib/services/attendance-engine.service")
        const { prisma } = await import("@/lib/prisma")
        // The 8th was paid as an absence, then made leave and refunded. Now the
        // leave is withdrawn: Ehab owes back what he was refunded.
        await prisma.dayOffRequest.delete({ where: { id: "late-leave" } })
        await Engine.recomputeMonth("c1", "2026-09")
        const rows = await prisma.attendanceDiscrepancy.findMany({ where: { userId: "e1", date: new Date("2026-09-08T00:00:00Z") }, orderBy: { detectedAt: "asc" } })
        expect(rows).toHaveLength(2)
        expect(rows[0]).toMatchObject({ paidDeductionMinor: 31000, nowDeductionMinor: 0, resolution: "Refunded 310.00 in October" })
        expect(rows[1]).toMatchObject({ paidDeductionMinor: 0, paidStatus: "LEAVE", nowStatus: "ABSENT", resolvedAt: null })
        expect(rows[1].nowDeductionMinor).toBeGreaterThan(0)
        // Leave again: back to what was settled, nothing left open for the day.
        await prisma.dayOffRequest.create({ data: { id: "late-leave", userId: "e1", type: "REGULAR", status: "APPROVED", date: new Date("2026-09-08T00:00:00Z") } })
        await Engine.recomputeMonth("c1", "2026-09")
        expect(await prisma.attendanceDiscrepancy.count({ where: { userId: "e1", date: new Date("2026-09-08T00:00:00Z") } })).toBe(1)
    })

    it("lists every open difference a page at a time, none cut off (review on #16)", async () => {
        const { AttendanceDiscrepancyService: Discrepancies } = await import("@/lib/services/attendance-discrepancy.service")
        const { rows: [run] } = await db.query(`SELECT id FROM "PayrollRun" WHERE "companyId" = 'c1'`)
        for (const day of ["01", "02", "03", "06", "07"]) {
            await db.query(`INSERT INTO "AttendanceDiscrepancy"(id, "companyId", "userId", date, "payrollRunId", "paidDeductionMinor", "paidOvertimeMinor", "nowDeductionMinor", "nowOvertimeMinor", "paidStatus", "nowStatus", "updatedAt")
                VALUES ($1, 'c1', 'a1', $2, $3, 100, 0, 0, 0, 'ABSENT', 'PRESENT', now())`, [`page-${day}`, `2026-09-${day}`, run.id])
        }
        const all = (await Discrepancies.list("c1", { limit: 1000 })).open.map(d => d.id)
        const seen: string[] = []
        let page = await Discrepancies.list("c1", { limit: 2 })
        expect(page.openCount).toBe(all.length)
        seen.push(...page.open.map(d => d.id))
        while (page.nextCursor) {
            page = await Discrepancies.list("c1", { limit: 2, after: page.nextCursor })
            expect(page.resolved).toEqual([])
            seen.push(...page.open.map(d => d.id))
        }
        expect(seen).toEqual(all)
        expect(all.length).toBeGreaterThan(5)
        await expect(Discrepancies.list("c1", { after: "yesterday" })).rejects.toThrow("INVALID_CURSOR")
    })

    it("is resolved once, however many settle it at the same moment (review on #16)", async () => {
        const { AttendanceDiscrepancyService: Discrepancies } = await import("@/lib/services/attendance-discrepancy.service")
        const outcomes = await Promise.allSettled([
            Discrepancies.resolve("page-01", "Refunded by bank transfer", "a1", false),
            Discrepancies.resolve("page-01", "Added to October's payslip", "a1", false),
        ])
        expect(outcomes.map(o => o.status).sort()).toEqual(["fulfilled", "rejected"])
        expect((outcomes.find(o => o.status === "rejected") as PromiseRejectedResult).reason.message).toBe("DISCREPANCY_ALREADY_RESOLVED")
        const { rows: audits } = await db.query(`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'RESOLVE_ATTENDANCE_DISCREPANCY' AND "entityId" = 'page-01'`)
        expect(audits[0].n).toBe(1)
    })
})
