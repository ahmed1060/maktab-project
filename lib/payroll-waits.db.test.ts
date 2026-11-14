import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { PayrollRunService as Payroll } from "@/lib/services/payroll-run.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { AttendanceExceptionService as Exceptions } from "@/lib/services/attendance-exception.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"
import { addDays, weekdayOf } from "@/lib/attendance/calendar"

/**
 * Payroll waits for days to settle, against a real Postgres built from the
 * migrations (ATTENDANCE_PLAN.md §6.9, §12.1, round 10, decisions 14 and 24,
 * PR 276): while a day of the month is incomplete or a departure to
 * confirm, its payroll can't be approved, and the register lists them, with
 * the month's requests not yet decided as a warning that doesn't stop it.
 *
 * Attendance reaches payroll from October 2026; approved on 3 November.
 * Ehab works 09:00–17:00 every working day but the 4th, scanned in at 09:40
 * and never out, and the 5th, gone at 13:30, three and a half hours early.
 * He has permission hours and a missing punch asked for and not decided,
 * and two hours' overtime on the 8th nobody approved. September, before
 * attendance reaches payroll, has an incomplete day of his too.
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

const NOW = new Date("2026-11-03T06:00:00Z")
const SESSION = { user: { id: "a1", role: "ADMIN" } }

describe.skipIf(!ADMIN_URL)("payroll waits for days to settle, in Postgres", () => {
    const dbName = `payroll_waits_test_${Date.now()}`
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
        await db.query(`UPDATE "Company" SET "attendancePayrollFrom" = '2026-10-01' WHERE id = 'c1'`)

        const { rows: holidays } = await db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM "PublicHoliday" WHERE date BETWEEN '2026-09-01' AND '2026-10-31'`)
        const off = new Set(holidays.map(h => h.d))
        const special: Record<string, string[]> = {
            "2026-09-30": ["09:00"],          // one scan, before attendance reaches payroll
            "2026-10-04": ["09:40"],          // one scan: incomplete
            "2026-10-05": ["09:00", "13:30"], // three and a half hours early: a departure to confirm
            "2026-10-08": ["09:00", "19:00"], // two hours' overtime, never decided
        }
        const rows: string[][] = [["AC-No.", "Check Time"]]
        for (let d = "2026-09-01"; d <= "2026-10-31"; d = addDays(d, 1)) {
            if (![0, 1, 2, 3, 4].includes(weekdayOf(d)) || off.has(d)) continue
            const dmy = (t: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${t}`
            rows.push(["2", dmy("09:00")], ["2", dmy("17:00")])
            for (const t of special[d] ?? ["09:00", "17:00"]) rows.push(["1", dmy(t)])
        }
        await Punches.mapCode("c1", { code: "1", userId: "e1" }, "a1")
        await Punches.mapCode("c1", { code: "2", userId: "a1" }, "e1")
        await Punches.importRows("c1", { name: "autumn.csv", hash: "autumn", rows }, { dateOrder: "DMY" }, "a1", true)

        // Asked for and not decided: permission hours on the 6th, a missing punch on the 7th.
        await db.query(`INSERT INTO "PermissionRequest"(id, "companyId", "userId", date, type, "startMinutes", "endMinutes", minutes, reason) VALUES
            ('p1', 'c1', 'e1', '2026-10-06', 'MIDDAY', 720, 780, 60, 'Bank')`)
        await db.query(`INSERT INTO "MissingPunchRequest"(id, "companyId", "userId", date, "claimedAt", direction, reason) VALUES
            ('m1', 'c1', 'e1', '2026-10-07', '2026-10-07 17:05:00', 'OUT', 'Forgot')`)
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

    const status = async () => (await db.query(`SELECT status FROM "PayrollRun" WHERE "companyId" = 'c1' AND year = 2026 AND month = 10`)).rows[0]?.status ?? null
    const day = async (date: string) => (await db.query(`SELECT status, "overtimeStatus" FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = $1`, [date])).rows[0]

    it("lists on the register the days to settle, with what each waits on and its scans, and the requests not yet decided", async () => {
        const view = await Payroll.view("c1", 2026, 10)
        expect(view.toSettle).toEqual({
            count: 2,
            byStatus: { INCOMPLETE: 1, TO_CONFIRM: 1 },
            days: [
                { userId: "e1", name: "Ehab One", date: "2026-10-04", status: "INCOMPLETE", firstIn: "2026-10-04T09:40:00.000Z", lastOut: null },
                { userId: "e1", name: "Ehab One", date: "2026-10-05", status: "TO_CONFIRM", firstIn: "2026-10-05T09:00:00.000Z", lastOut: "2026-10-05T13:30:00.000Z" },
            ],
            requests: { permissions: 1, missing: 1, overtime: 1 },
        })
    })

    it("refuses to approve while they wait, naming whose they are, and changes nothing", async () => {
        const out = await Payroll.approve("c1", 2026, 10, SESSION)
        expect(out).toEqual({ refusal: expect.objectContaining({ code: "DAYS_TO_SETTLE", names: ["Ehab One"] }) })
        expect(await status()).toBeNull()
        // Undecided overtime is rejected only by an approval that goes ahead.
        expect((await day("2026-10-08")).overtimeStatus).toBe("PENDING")
    })

    it("refuses a day whose stored row was out of date too, found inside approval's transaction, and keeps its recompute", async () => {
        await Exceptions.decide("c1", { userId: "e1", date: "2026-10-04", subject: "INCOMPLETE", outcome: "ACCEPTED", reason: "Went home ill" }, "a1")
        await Exceptions.decide("c1", { userId: "e1", date: "2026-10-05", subject: "EARLY_LEAVE", outcome: "ACCEPTED" }, "a1")
        expect((await Payroll.view("c1", 2026, 10)).toSettle?.count).toBe(0)
        // The 11th's scan out gone, its day not worked out again: stored, it's still present.
        await db.query(`DELETE FROM "AttendancePunch" WHERE id = (SELECT id FROM "AttendancePunch" WHERE "userId" = 'e1' AND "punchAtLocal" >= '2026-10-11' AND "punchAtLocal" < '2026-10-12' ORDER BY "punchAtLocal" DESC LIMIT 1)`)
        expect((await day("2026-10-11")).status).toBe("PRESENT")

        const out = await Payroll.approve("c1", 2026, 10, SESSION)
        expect(out).toEqual({ refusal: expect.objectContaining({ code: "DAYS_TO_SETTLE", names: ["Ehab One"] }) })
        expect(await status()).toBeNull()
        expect((await day("2026-10-11")).status).toBe("INCOMPLETE")
        expect((await day("2026-10-08")).overtimeStatus).toBe("PENDING")
        expect((await Payroll.view("c1", 2026, 10)).toSettle?.days.map(d => d.date)).toEqual(["2026-10-11"])
    })

    it("checks the register being approved, not the one read before: someone on it since is refused too, and nothing is kept (review on PR 276)", async () => {
        await Exceptions.decide("c1", { userId: "e1", date: "2026-10-11", subject: "INCOMPLETE", outcome: "EXCUSED", reason: "At a client" }, "a1")
        // As if Amal were put back on the payroll between the register read
        // before approving and the one approved: the first leaves her out.
        const compute = Payroll.compute.bind(Payroll)
        const spy = vi.spyOn(Payroll, "compute").mockImplementationOnce(async (...args: Parameters<typeof Payroll.compute>) => {
            const out = await compute(...args)
            return { ...out, register: { ...out.register, entries: out.register.entries.filter(e => e.userId !== "a1") } }
        })
        // Her scan out on the 12th gone, her day not worked out again.
        const { rows: [gone] } = await db.query(`SELECT row_to_json(p) AS row FROM "AttendancePunch" p WHERE "userId" = 'a1' AND "punchAtLocal" >= '2026-10-12' AND "punchAtLocal" < '2026-10-13' ORDER BY "punchAtLocal" DESC LIMIT 1`)
        await db.query(`DELETE FROM "AttendancePunch" WHERE id = $1`, [gone.row.id])
        try {
            const out = await Payroll.approve("c1", 2026, 10, SESSION)
            // Undone, the register read again can't show her day: the refusal carries it (review on PR 276).
            expect(out).toEqual({ refusal: expect.objectContaining({
                code: "DAYS_TO_SETTLE", names: ["Amal One"],
                waiting: expect.objectContaining({ count: 1, byStatus: { INCOMPLETE: 1, TO_CONFIRM: 0 }, days: [expect.objectContaining({ name: "Amal One", date: "2026-10-12", status: "INCOMPLETE", firstIn: "2026-10-12T09:00:00.000Z" })] }),
            }) })
        } finally {
            spy.mockRestore()
            await db.query(`INSERT INTO "AttendancePunch" SELECT * FROM json_populate_record(NULL::"AttendancePunch", $1)`, [JSON.stringify(gone.row)])
        }
        // Refused once the register to approve was built: all of it undone.
        expect(await status()).toBeNull()
        expect((await day("2026-10-08")).overtimeStatus).toBe("PENDING")
        expect((await db.query(`SELECT status FROM "AttendanceDay" WHERE "userId" = 'a1' AND date = '2026-10-12'`)).rows[0].status).toBe("PRESENT")
    })

    it("approves once they're settled, the requests not yet decided not stopping it", async () => {
        const out = await Payroll.approve("c1", 2026, 10, SESSION)
        expect(out).toEqual({ runId: expect.any(String) })
        expect(await status()).toBe("APPROVED")
        expect((await day("2026-10-08")).overtimeStatus).toBe("REJECTED")
        // Approved, nothing waits on its register.
        expect((await Payroll.view("c1", 2026, 10)).toSettle).toBeNull()
    })

    it("waits for nothing in a month attendance doesn't reach, where it charges nobody", async () => {
        expect((await day("2026-09-30")).status).toBe("INCOMPLETE")
        expect((await Payroll.view("c1", 2026, 9)).toSettle).toBeNull()
        expect(await Payroll.approve("c1", 2026, 9, SESSION)).toEqual({ runId: expect.any(String) })
    })
})
