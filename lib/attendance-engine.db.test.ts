import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceEngineService as Engine } from "@/lib/services/attendance-engine.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"
import { addDays, weekdayOf } from "@/lib/attendance/calendar"
import type { Cell } from "@/lib/attendance/punch-import"

/**
 * A whole month through the engine, against a real Postgres built from the
 * migrations (ATTENDANCE_PLAN.md §11, Phase 0's exit check on generated data):
 * a schedule, a policy, salaries with a mid-month raise, leave, and a
 * terminal's file of punches imported and mapped — then every day's status,
 * minutes and money checked by hand.
 *
 * September 2026 throughout: a past month, since days are derived once over.
 * 1 September 2026 is a Tuesday; the work week is Sunday to Thursday.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e3', 'e3@x', 'p', 'Eman', 'Three', 'EMPLOYEE', 2026, 'e3', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Essam', 'Two', 'EMPLOYEE', 2026, 'e2', 'c2', NULL);
`

/** Ehab's September, as the terminal saw it: on time unless listed. */
const EHAB: Record<string, [string, string][] | null> = {
    "2026-09-02": [["09:25", "17:00"]],               // late 25: the first free one
    "2026-09-03": [["09:25", "17:00"]],               // late 25: the second free one
    "2026-09-06": [["09:25", "17:00"]],               // late 25: charged a quarter day
    "2026-09-07": [["09:00", ""]],                    // forgot to punch out: incomplete
    "2026-09-08": null,                               // absent
    "2026-09-09": null,                               // on approved leave
    "2026-09-10": [["09:00", "18:30"]],               // 90 minutes' overtime, awaiting approval
    "2026-09-13": [["09:00", "13:00"], ["14:00", "16:00"]], // left an hour early, after a lunch break
    "2026-09-16": null,                               // absent, after the raise
}

function terminalFile(): Cell[][] {
    const rows: Cell[][] = [["AC-No.", "Name", "Check Time", "State"]]
    const dmy = (d: string, t: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${t}`
    for (let d = "2026-09-01"; d <= "2026-09-30"; d = addDays(d, 1)) {
        if (![0, 1, 2, 3, 4].includes(weekdayOf(d))) continue
        const pairs = d in EHAB ? EHAB[d] : [["09:00", "17:00"]] as [string, string][]
        for (const [a, b] of pairs ?? []) {
            rows.push(["1", "Ehab", dmy(d, a), "C/In"])
            if (b) rows.push(["1", "Ehab", dmy(d, b), "C/Out"])
        }
    }
    // A Saturday's work, a rest day.
    rows.push(["1", "Ehab", "12/09/2026 10:00", "C/In"], ["1", "Ehab", "12/09/2026 14:00", "C/Out"])
    // Eman works nights: in at 21:55, out the next morning.
    rows.push(["3", "Eman", "01/09/2026 21:55", "C/In"], ["3", "Eman", "02/09/2026 06:05", "C/Out"])
    return rows
}

describe.skipIf(!ADMIN_URL)("the attendance engine, a month in Postgres", () => {
    const dbName = `engine_test_${Date.now()}`
    let db: Client

    beforeAll(async () => {
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

        // 9,300.00 a month from January; 12,000.00 from 15 September (Cairo midnight, +03:00).
        await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES
            ('s1', 'e1', 9300, '2026-01-01T00:00:00Z'), ('s2', 'e1', 12000, '2026-09-14T21:00:00Z'), ('s3', 'e3', 9000, '2026-01-01T00:00:00Z')`)
        await db.query(`INSERT INTO "DayOffRequest"(id, "userId", type, status, date, "updatedAt") VALUES ('l1', 'e1', 'REGULAR', 'APPROVED', '2026-09-09T00:00:00Z', now())`)

        // Hessa: hired at 14:00 on 3 September, suspended from 10:00 on the 10th to 10:00 on the 13th (Cairo, +03:00).
        await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId")
            SELECT 'e4', 'e4@x', 'p', 'Hessa', 'Four', 'EMPLOYEE', 2026, 'e4', 'c1', id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)
        await db.query(`INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES
            ('h4', 'e4', 'HIRED', '2026-09-03T11:00:00Z'), ('s4', 'e4', 'SUSPENDED', '2026-09-10T07:00:00Z'), ('u4', 'e4', 'UNSUSPENDED', '2026-09-13T07:00:00Z')`)

        await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: "2026-09-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        const night = await Calendar.createSchedule("c1", { name: "Night", version: { effectiveFrom: "2026-09-01", startMinutes: 1320, endMinutes: 1800, breakMinutes: 30 } }, "a1")
        await Calendar.assign("c1", { userIds: ["e3"], scheduleId: night.id, effectiveFrom: "2026-09-01" }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-09-01", body: STANDARD_OFFICE }, "a1")

        await Punches.importRows("c1", { name: "september.csv", hash: "sep", rows: terminalFile() }, { dateOrder: "DMY" }, "a1", true)
        await Punches.mapCode("c1", { code: "1", userId: "e1" }, "a1")
        await Punches.mapCode("c1", { code: "3", userId: "e3" }, "a1")
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const days = async (userId: string) => {
        const { rows } = await db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d, * FROM "AttendanceDay" WHERE "userId" = $1 ORDER BY date`, [userId])
        return new Map(rows.map(r => [r.d as string, r]))
    }

    it("derived the month as the punches arrived and were mapped, from the first punch on", async () => {
        // Ehab, Eman and Amal, the Admin, 30 days each; Hessa from her first day, the 3rd.
        // September's only: once 1 October is over, the next month has its own days (they run on the real clock).
        expect((await db.query(`SELECT count(*)::int AS n FROM "AttendanceDay" WHERE "companyId" = 'c1' AND date < '2026-10-01'`)).rows[0].n).toBe(90 + 28)
        // Asked again, it finds nothing to change; a company with no punches has no days.
        expect(await Engine.recomputeMonth("c1", "2026-09")).toMatchObject({ locked: false, derived: 118, written: 0 })
        expect(await Engine.recomputeMonth("c2", "2026-09")).toMatchObject({ derived: 0, written: 0 })
        expect((await db.query(`SELECT count(*)::int AS n FROM "AttendanceDay" WHERE "companyId" = 'c2'`)).rows[0].n).toBe(0)
    })

    it("measures Ehab's month as it happened", async () => {
        const e = await days("e1")
        const status = (d: string) => e.get(d)?.status
        expect([status("2026-09-01"), status("2026-09-02"), status("2026-09-05"), status("2026-09-07"), status("2026-09-08"), status("2026-09-09"), status("2026-09-12")])
            .toEqual(["PRESENT", "PRESENT", "REST", "INCOMPLETE", "ABSENT", "LEAVE", "WORKED_REST_DAY"])
        expect(e.get("2026-09-13")).toMatchObject({ workedMinutes: 360, earlyLeaveMinutes: 60, lateMinutes: 0 })
        expect(e.get("2026-09-10")).toMatchObject({ overtimeMinutes: 90, overtimeStatus: "PENDING", overtimeMinor: 0 })
        expect(e.get("2026-09-12")).toMatchObject({ overtimeMinutes: 240, overtimeStatus: "PENDING" })
        expect(e.get("2026-09-01")).toMatchObject({ expectedStartMinutes: 540, expectedEndMinutes: 1020, breakMinutes: 60, punchCount: 2 })
        expect(e.get("2026-09-01")!.policyId).toBeTruthy()
    })

    it("prices it in order and at each day's salary", async () => {
        const e = await days("e1")
        // 9,300.00 over 30 days is 310.00 a day; 12,000.00 is 400.00.
        expect(e.get("2026-09-02")!.breakdown.lateness).toMatchObject({ note: "FREE_OCCURRENCE", occurrence: 1 })
        expect(e.get("2026-09-03")!.breakdown.lateness).toMatchObject({ note: "FREE_OCCURRENCE", occurrence: 2 })
        expect(e.get("2026-09-06")).toMatchObject({ deductionMinor: 7750 })
        expect(Number(e.get("2026-09-06")!.deductionDays)).toBe(0.25)
        expect(e.get("2026-09-07")).toMatchObject({ deductionMinor: 0 })
        expect(e.get("2026-09-07")!.breakdown.unpriced).toBe("INCOMPLETE")
        expect(e.get("2026-09-08")).toMatchObject({ deductionMinor: 31000 })
        // Early leave of 60 minutes: band 31–60, half a day, at the new salary.
        expect(e.get("2026-09-13")).toMatchObject({ deductionMinor: 15500 })
        expect(e.get("2026-09-16")).toMatchObject({ deductionMinor: 40000 })
        expect(e.get("2026-09-09")).toMatchObject({ deductionMinor: 0 })
    })

    it("replays the month under a draft policy, per person, writing nothing (§6.7)", async () => {
        const { rows: [before] } = await db.query(`SELECT count(*)::int AS n, max("derivedAt") AS at, sum("deductionMinor")::int AS minor FROM "AttendanceDay" WHERE "userId" = 'e1' AND date < '2026-10-01'`)
        // The policy in force, as a draft: the same figures the days hold.
        const same = await Engine.simulate("c1", "2026-09", STANDARD_OFFICE)
        const ehab = (r: typeof same) => r.people.find(p => p.userId === "e1")!
        expect(ehab(same).current).toEqual(ehab(same).draft)
        expect(ehab(same).current.deductionMinor).toBe(before.minor)
        // Absence at two days each: Ehab's two absences cost one more day each,
        // at that day's salary — 310.00 on the 8th, 400.00 on the 16th.
        const strict = await Engine.simulate("c1", "2026-09", { ...STANDARD_OFFICE, absence: { multiplier: 2 } })
        expect(ehab(strict).draft.deductionMinor - ehab(strict).current.deductionMinor).toBe(31000 + 40000)
        expect(strict.totals.draft.deductionMinor).toBeGreaterThan(strict.totals.current.deductionMinor)
        const { rows: [after] } = await db.query(`SELECT count(*)::int AS n, max("derivedAt") AS at, sum("deductionMinor")::int AS minor FROM "AttendanceDay" WHERE "userId" = 'e1' AND date < '2026-10-01'`)
        expect(after).toEqual(before)
    })

    it("counts a day employment touches, and only whole days of a suspension (review on #13)", async () => {
        const h = await days("e4")
        // Hired at 14:00 on the 3rd: the 3rd is hers, the 2nd is not.
        expect(h.has("2026-09-02")).toBe(false)
        expect(h.get("2026-09-03")!.status).toBe("ABSENT")
        // Suspended from 10:00 on the 10th to 10:00 on the 13th: only the 11th and 12th are whole days.
        expect(["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"].map(d => h.get(d)!.status)).toEqual(["ABSENT", "SUSPENDED", "SUSPENDED", "ABSENT"])
    })

    it("keeps a night shift's morning check-out on the night it started", async () => {
        const e = await days("e3")
        expect(e.get("2026-09-01")).toMatchObject({ status: "PRESENT", lateMinutes: 0, overtimeMinutes: 5, overtimeStatus: "NOT_COUNTED", workedMinutes: 490 })
        expect(e.get("2026-09-02")!.status).toBe("ABSENT")
    })

    it("rebuilds the night before when a file brings only a night shift's morning check-out (review on #13)", async () => {
        // Eman's 30 September night, across the month's end: in by hand at 21:58,
        // then a file with only the 06:01 check-out of 1 October.
        await Punches.addManual("c1", { userId: "e3", at: "2026-09-30T21:58", direction: "IN", note: "Badge reader down" }, "a1")
        expect((await days("e3")).get("2026-09-30")!.status).toBe("INCOMPLETE")
        await Punches.importRows("c1", { name: "morning.csv", hash: "morning", rows: [["AC-No.", "Name", "Check Time", "State"], ["3", "Eman", "01/10/2026 06:01", "C/Out"]] }, { dateOrder: "DMY" }, "a1", true)
        expect((await days("e3")).get("2026-09-30")).toMatchObject({ status: "PRESENT", workedMinutes: 483 })
        // Withdrawing that file takes the night back to incomplete, the night before included.
        const { rows: [imp] } = await db.query(`SELECT id FROM "AttendanceImport" WHERE "fileHash" = 'morning'`)
        await Punches.voidImport(imp.id, "Wrong file", "a1")
        expect((await days("e3")).get("2026-09-30")!.status).toBe("INCOMPLETE")
    })

    it("rebuilds the day a correction touches, as part of the correction", async () => {
        await Punches.addManual("c1", { userId: "e1", at: "2026-09-07T17:00", direction: "OUT", note: "Forgot to punch out" }, "a1")
        expect((await days("e1")).get("2026-09-07")).toMatchObject({ status: "PRESENT", deductionMinor: 0 })
        expect(await Engine.recomputeMonth("c1", "2026-09")).toMatchObject({ written: 0 })
    })

    it("rebuilds the month when the calendar changes: a company holiday turns an absence into a holiday", async () => {
        await Calendar.addHoliday("c1", { date: "2026-09-08", name: "Founders' Day" }, "a1")
        expect((await days("e1")).get("2026-09-08")).toMatchObject({ status: "HOLIDAY", deductionMinor: 0 })
    })

    it("reprices the days a salary change reaches back to, as it is recorded (review on #13)", async () => {
        const { SalaryHistoryService } = await import("@/lib/services/salary-history.service")
        // The half day for leaving early on the 13th, at 9,300.00 a month.
        expect((await days("e1")).get("2026-09-13")).toMatchObject({ deductionMinor: 15500 })
        // A correction: 15,000.00 from 1 September (Cairo midnight, +03:00), entered late.
        await SalaryHistoryService.record({ userId: "e1", monthlyAmount: 15000, effectiveFrom: new Date("2026-08-31T21:00:00Z"), reason: "Correction" })
        expect((await days("e1")).get("2026-09-13")).toMatchObject({ deductionMinor: 25000 })
    })

    it("rebuilds at night the months a recent salary change reaches back to, and one company failing does not stop the rest (review on #13)", async () => {
        // Written straight to the table, as one recorded inside another change's transaction would be: no rebuild yet.
        await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES ('s9', 'e3', 9500, '2026-06-30T21:00:00Z')`)
        // Company Two has a punch and an unreadable stored policy, so its rebuild throws.
        await db.query(`INSERT INTO "AttendancePolicy"(id, "companyId", "effectiveFrom", body, "createdById") VALUES ('bad', 'c2', '2026-09-01', '{"workWeek": []}', 'a1')`)
        await db.query(`INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone") VALUES ('c2p', 'c2', 'e2', 'MANUAL', 'c2p', '2026-09-07 09:00', now(), 'Africa/Cairo')`)
        // The setup's own rows are old news by now; only s9 and the correction above are recent.
        await db.query(`UPDATE "SalaryChange" SET "createdAt" = now() - interval '10 days' WHERE id NOT IN ('s9') AND reason IS DISTINCT FROM 'Correction'`)
        await db.query(`UPDATE "EmploymentEvent" SET "createdAt" = now() - interval '10 days'`)
        const both = await Engine.reconcileAll(["c2", "c1"])
        expect(both.failed.length).toBeGreaterThan(0)
        expect(both.failed.every(f => f.companyId === "c2")).toBe(true)
        // c1 alone: from July, the month s9 reaches back to, to this month.
        const today = new Date().toISOString().slice(0, 7)
        const expected = (Number(today.slice(0, 4)) - 2026) * 12 + Number(today.slice(5, 7)) - 7 + 1
        expect((await Engine.reconcileAll(["c1"]))).toMatchObject({ months: expected, failed: [] })
        await db.query(`DELETE FROM "AttendancePolicy" WHERE id = 'bad'`)
        await db.query(`DELETE FROM "AttendancePunch" WHERE id = 'c2p'`)
    })

    it("reaches back past nights the job missed or failed, to two days before its last success (review on #13)", async () => {
        await db.query(`UPDATE "SalaryChange" SET "createdAt" = now() - interval '10 days'`)
        // Recorded five days ago, inside another change's transaction; the job last got through six days ago.
        await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom", "createdAt") VALUES ('s10', 'e3', 9400, '2026-05-31T21:00:00Z', now() - interval '5 days')`)
        await db.query(`INSERT INTO "JobHeartbeat"(job, "lastRunAt", "lastSuccessAt", "updatedAt") VALUES ('attendance', now(), now() - interval '6 days', now())`)
        // From June, the month s10 reaches back to, to this month.
        const today = new Date().toISOString().slice(0, 7)
        const expected = (Number(today.slice(0, 4)) - 2026) * 12 + Number(today.slice(5, 7)) - 6 + 1
        expect(await Engine.reconcileAll(["c1"])).toMatchObject({ months: expected, failed: [] })
        // Run before, but never through: every change counts, as far back as a rebuild reaches — the salaries
        // from January, within the year (review on #49).
        await db.query(`UPDATE "JobHeartbeat" SET "lastSuccessAt" = NULL, "lastFailureAt" = now() WHERE job = 'attendance'`)
        const monthIndex = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1
        expect(await Engine.reconcileAll(["c1"])).toMatchObject({ months: monthIndex - Math.max(2026 * 12, monthIndex - 12) + 1, failed: [] })
        // Got through last night: two days back from then, as before.
        await db.query(`UPDATE "JobHeartbeat" SET "lastSuccessAt" = now() WHERE job = 'attendance'`)
        expect(await Engine.reconcileAll(["c1"])).toMatchObject({ months: 2, failed: [] })
        await db.query(`DELETE FROM "JobHeartbeat" WHERE job = 'attendance'`)
        await db.query(`DELETE FROM "SalaryChange" WHERE id = 's10'`)
    })

    it("never rewrites a month whose payroll is approved", async () => {
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt") VALUES ('run9', 'c1', 9, 2026, 'APPROVED', 25, now())`)
        const before = (await days("e1")).get("2026-09-08")!.derivedAt
        await db.query(`DELETE FROM "DayOffRequest"`)
        expect(await Engine.recomputeMonth("c1", "2026-09")).toMatchObject({ locked: true, written: 0 })
        expect((await days("e1")).get("2026-09-08")!.derivedAt).toEqual(before)
    })

    it("refuses a punch after midnight that belongs to a night in the approved month (review on #14)", async () => {
        // Eman's 30 September night ends at 06:00 on 1 October; with its late
        // margin, a punch up to noon is that night's — a September day.
        await expect(Punches.addManual("c1", { userId: "e3", at: "2026-10-01T06:30", direction: "OUT", note: "Forgot" }, "a1"))
            .rejects.toThrow("PAYROLL_MONTH_LOCKED")
        // Ehab's office day ended at 17:00 on the 30th: his 06:30 is October's, and open.
        const { id } = await Punches.addManual("c1", { userId: "e1", at: "2026-10-01T06:30", direction: "IN", note: "Early start" }, "a1")
        // Withdrawing one of that night's is refused the same way.
        await db.query(`UPDATE "AttendancePunch" SET "userId" = 'e3' WHERE id = $1`, [id])
        await expect(Punches.voidPunch(id, "Wrong person", "a1")).rejects.toThrow("PAYROLL_MONTH_LOCKED")
    })

    it("holds a file's, a number's and a withdrawal's punch after midnight to the night's approved month too (review on #13)", async () => {
        // Eman's 06:20 on 1 October closes her 30 September night; Ehab's is October's.
        const file = { name: "first.csv", hash: "first", rows: [["AC-No.", "Name", "Check Time", "State"], ["3", "Eman", "01/10/2026 06:20", "C/Out"], ["1", "Ehab", "01/10/2026 06:20", "C/In"]] }
        expect(await Punches.importRows("c1", file, { dateOrder: "DMY" }, "a1", false)).toMatchObject({ ready: 1, locked: 1 })
        const done = await Punches.importRows("c1", file, { dateOrder: "DMY" }, "a1", true)
        expect(done).toMatchObject({ added: 1, locked: 1 })
        const { rows: stored } = await db.query(`SELECT id, "userId" FROM "AttendancePunch" WHERE "importId" = $1`, [done.importId])
        expect(stored.map(r => r.userId)).toEqual(["e1"])
        // A number nobody had, mapped to Eman: her waiting 06:10 stays unmatched, as September was paid without it.
        await db.query(`INSERT INTO "AttendancePunch"(id, "companyId", source, "sourceKey", "importId", "hardwareUserId", "punchAtLocal", "punchAt", "resolvedWithTimeZone")
            VALUES ('waiting-9', 'c1', 'IMPORT', 'first:waiting-9', $1, '9', '2026-10-01 06:10', now(), 'Africa/Cairo')`, [done.importId])
        expect(await Punches.mapCode("c1", { code: "9", userId: "e3" }, "a1")).toMatchObject({ filled: 0, leftInLockedMonths: 1 })
        // The file's punch, had it been Eman's, can't be withdrawn with it either.
        await db.query(`UPDATE "AttendancePunch" SET "userId" = 'e3' WHERE id = $1`, [stored[0].id])
        await expect(Punches.voidImport(done.importId!, "Wrong file", "a1")).rejects.toThrow("PAYROLL_MONTH_LOCKED")
    })

    it("waits out a long import's locks instead of failing after Prisma's five seconds (review on #12)", async () => {
        // A file still going in holds the numbers' lock.
        await db.query("BEGIN")
        await db.query(`SELECT pg_advisory_xact_lock(hashtext('attendance-codes:c1'))::text`)
        const mapping = Punches.mapCode("c1", { code: "77", userId: "e1" }, "a1")
        mapping.catch(() => {})
        await new Promise(r => setTimeout(r, 5_500))
        await db.query("COMMIT")
        expect(await mapping).toMatchObject({ filled: 0 })
    }, 20_000)

    it("derives no day that has not ended", async () => {
        const result = await Engine.recomputeMonth("c1", "2099-01")
        expect(result).toMatchObject({ derived: 0, written: 0 })
    })

    it("holds its own measures to never negative", async () => {
        await expect(db.query(`UPDATE "AttendanceDay" SET "lateMinutes" = -1 WHERE "userId" = 'e1'`)).rejects.toThrow(/AttendanceDay_not_negative/)
    })
})
