import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import {
    MEASURE_ONLY, MISSION_AMOUNT_MAX_MINOR, MISSION_PAYS, NO_MISSION_ALLOWANCE, SIX_DAY_FACTORY, STANDARD_OFFICE,
    policyBodySchema, policyProblem, type PolicyBody,
} from "./attendance/policy"
import { KNOWN_REFUSALS } from "./api-errors"
import { bodyFromForm, formFromBody } from "@/components/attendance-policy/policy-form"

/**
 * The mission allowance, بدل مأمورية (ATTENDANCE_PLAN.md §6.10, decisions 6,
 * 9 and 12; §20, Phase 5 part 5). Its settings in the attendance policy
 * first (PR 286): what each kind of mission pays and what one day is worth,
 * nothing to start. Then each mission day priced (PR 287): kept on the day,
 * and shown on the Days list to whoever may see that person's pay; the
 * pricing itself is in lib/attendance/engine.test.ts, and the days as kept
 * in lib/mission-allowance.db.test.ts. Then paid with salary (PR 288): an
 * earning on the payslip, written at approval as its own attendance entry.
 * Then across a closed month (PR 289): a difference carries the allowance,
 * for those the run paid.
 */

const withAllowance = (allowance: Partial<PolicyBody["missions"]["allowance"]>, enabled = true): PolicyBody => ({
    ...STANDARD_OFFICE, missions: { ...STANDARD_OFFICE.missions, enabled, allowance: { ...NO_MISSION_ALLOWANCE, ...allowance } },
})
const parses = (allowance: object) => policyBodySchema.safeParse({ ...STANDARD_OFFICE, missions: { enabled: true, allowance: { ...NO_MISSION_ALLOWANCE, ...allowance } } }).success

describe("the allowance's settings (decisions 6 and 12, PR 286)", () => {
    it("start at nothing for both kinds, in every starting policy", () => {
        expect(NO_MISSION_ALLOWANCE).toEqual({ dayWorth: "OWN_PAY", amountMinor: 0, days: 0, hours: 0 })
        for (const body of [STANDARD_OFFICE, SIX_DAY_FACTORY, MEASURE_ONLY]) expect(body.missions).toEqual({ enabled: true, allowance: NO_MISSION_ALLOWANCE, daysBack: 7 })
    })

    it("read as nothing in a version saved before them, so nothing is migrated", () => {
        // Saved by #283, with the switch alone.
        const off = policyBodySchema.parse({ ...STANDARD_OFFICE, missions: { enabled: false } })
        expect(off.missions).toEqual({ enabled: false, allowance: NO_MISSION_ALLOWANCE, daysBack: 7 })
        // Saved before missions, with neither.
        const older: Record<string, unknown> = { ...STANDARD_OFFICE }
        delete older.missions
        expect(policyBodySchema.parse(older).missions).toEqual({ enabled: true, allowance: NO_MISSION_ALLOWANCE, daysBack: 7 })
    })

    it("take what each kind pays: nothing, a quarter, a half, one or two days", () => {
        expect(MISSION_PAYS).toEqual([0, 0.25, 0.5, 1, 2])
        for (const pays of MISSION_PAYS) {
            expect(parses({ days: pays }), `days ${pays}`).toBe(true)
            expect(parses({ hours: pays }), `hours ${pays}`).toBe(true)
        }
        for (const pays of [0.75, 1.5, 3, -1, "1"]) {
            expect(parses({ days: pays }), `days ${pays}`).toBe(false)
            expect(parses({ hours: pays }), `hours ${pays}`).toBe(false)
        }
    })

    it("take what one day is worth: the employee's own day's pay, or an amount up to 100,000", () => {
        expect(MISSION_AMOUNT_MAX_MINOR).toBe(100_000_00)
        expect(parses({ dayWorth: "OWN_PAY" })).toBe(true)
        expect(parses({ dayWorth: "AMOUNT", amountMinor: 200_00 })).toBe(true)
        expect(parses({ dayWorth: "AMOUNT", amountMinor: MISSION_AMOUNT_MAX_MINOR })).toBe(true)
        expect(parses({ dayWorth: "AMOUNT", amountMinor: MISSION_AMOUNT_MAX_MINOR + 1 })).toBe(false)
        expect(parses({ dayWorth: "AMOUNT", amountMinor: -1 })).toBe(false)
        // Minor units are whole.
        expect(parses({ dayWorth: "AMOUNT", amountMinor: 12.5 })).toBe(false)
        expect(parses({ dayWorth: "HALF_PAY" })).toBe(false)
    })

    it("need the amount once one day is worth an amount and either kind pays", () => {
        expect(policyProblem(withAllowance({ dayWorth: "AMOUNT", days: 1 }))).toBe("MISSION_ALLOWANCE_AMOUNT_MISSING")
        expect(policyProblem(withAllowance({ dayWorth: "AMOUNT", hours: 0.5 }))).toBe("MISSION_ALLOWANCE_AMOUNT_MISSING")
        expect(policyProblem(withAllowance({ dayWorth: "AMOUNT", days: 1, amountMinor: 200_00 }))).toBeNull()
        // Paying nothing, the amount isn't read; nor when one day is the employee's own.
        expect(policyProblem(withAllowance({ dayWorth: "AMOUNT" }))).toBeNull()
        expect(policyProblem(withAllowance({ dayWorth: "OWN_PAY", days: 2, hours: 1 }))).toBeNull()
        // With asking off too: a mission approved before still counts.
        expect(policyProblem(withAllowance({ dayWorth: "AMOUNT", days: 1 }, false))).toBe("MISSION_ALLOWANCE_AMOUNT_MISSING")
        expect(KNOWN_REFUSALS.MISSION_ALLOWANCE_AMOUNT_MISSING).toMatchObject({ status: 400 })
    })
})

describe("the policy form", () => {
    const formOf = (allowance: Partial<PolicyBody["missions"]["allowance"]>) => formFromBody(withAllowance(allowance))
    const save = (missions: Partial<ReturnType<typeof formFromBody>["missions"]>, base: PolicyBody = STANDARD_OFFICE) =>
        bodyFromForm({ ...formFromBody(base), missions: { ...formFromBody(base).missions, ...missions } }, base)

    it("holds the amount as typed, in the currency's own units, and empty while there's none", () => {
        expect(formFromBody(STANDARD_OFFICE).missions).toEqual({ enabled: true, dayWorth: "OWN_PAY", amount: "", days: 0, hours: 0, daysBack: "7" })
        expect(formOf({ dayWorth: "AMOUNT", amountMinor: 200_00, days: 1, hours: 0.5 }).missions).toEqual({ enabled: true, dayWorth: "AMOUNT", amount: "200", days: 1, hours: 0.5, daysBack: "7" })
        expect(formOf({ dayWorth: "AMOUNT", amountMinor: 12_50 }).missions.amount).toBe("12.5")
    })

    it("round-trips what's set", () => {
        for (const allowance of [
            NO_MISSION_ALLOWANCE,
            { dayWorth: "OWN_PAY" as const, amountMinor: 0, days: 1 as const, hours: 0.5 as const },
            { dayWorth: "AMOUNT" as const, amountMinor: 200_00, days: 2 as const, hours: 0.25 as const },
            { dayWorth: "AMOUNT" as const, amountMinor: 1, days: 0 as const, hours: 1 as const },
        ]) {
            const body = withAllowance(allowance, false)
            const out = bodyFromForm(formFromBody(body), body)
            expect(out.ok && out.body.missions).toEqual({ enabled: false, allowance, daysBack: 7 })
        }
    })

    it("reads the amount typed, to the piastre", () => {
        const out = save({ dayWorth: "AMOUNT", days: 1, amount: "150.75" })
        expect(out.ok && out.body.missions.allowance).toEqual({ dayWorth: "AMOUNT", amountMinor: 150_75, days: 1, hours: 0 })
        const least = save({ dayWorth: "AMOUNT", hours: 2, amount: "0.01" })
        expect(least.ok && least.body.missions.allowance.amountMinor).toBe(1)
        const most = save({ dayWorth: "AMOUNT", hours: 2, amount: "100000" })
        expect(most.ok && most.body.missions.allowance.amountMinor).toBe(MISSION_AMOUNT_MAX_MINOR)
    })

    it("says under the amount when it's missing or out of range, once it's needed", () => {
        for (const amount of ["", "abc", "0", "0.001", "100000.01", "-5"]) {
            const out = save({ dayWorth: "AMOUNT", days: 1, amount })
            expect(out.ok, amount).toBe(false)
            expect(!out.ok && out.errors["missions.amount"], amount).toEqual({ key: "number_between", min: 0.01, max: 100000 })
        }
    })

    it("doesn't stop the save for an amount nobody reads: paying nothing, or one day worth the employee's own", () => {
        const base = withAllowance({ dayWorth: "AMOUNT", amountMinor: 300_00, days: 1 })
        // Both kinds set to nothing, and the amount emptied: what the version had stands.
        const nothing = save({ days: 0, hours: 0, amount: "" }, base)
        expect(nothing.ok && nothing.body.missions.allowance).toEqual({ dayWorth: "AMOUNT", amountMinor: 300_00, days: 0, hours: 0 })
        // One day worth the employee's own: the amount is kept for when it's chosen again.
        const own = save({ dayWorth: "OWN_PAY", amount: "abc" }, base)
        expect(own.ok && own.body.missions.allowance).toEqual({ dayWorth: "OWN_PAY", amountMinor: 300_00, days: 1, hours: 0 })
        // And one that reads is kept as typed.
        const typed = save({ dayWorth: "OWN_PAY", amount: "450" }, base)
        expect(typed.ok && typed.body.missions.allowance.amountMinor).toBe(450_00)
    })

    it("keeps the allowance while missions can't be asked for: one approved before still counts", () => {
        const out = save({ enabled: false, dayWorth: "AMOUNT", days: 1, amount: "200" })
        expect(out.ok && out.body.missions).toEqual({ enabled: false, allowance: { dayWorth: "AMOUNT", amountMinor: 200_00, days: 1, hours: 0 }, daysBack: 7 })
        const missing = save({ enabled: false, dayWorth: "AMOUNT", days: 1, amount: "" })
        expect(missing.ok).toBe(false)
    })
})

describe("the policy dialog's Missions section", () => {
    const dialog = readFileSync("components/attendance-policy/PolicyDialog.tsx", "utf8")

    it("asks what each kind pays, each nothing, a quarter, a half, one or two days", () => {
        expect(dialog).toContain("t('attendance_mission_allowance')")
        expect(dialog).toContain("label={t('attendance_mission_days_pays')}")
        expect(dialog).toContain("hint={t('attendance_mission_days_pays_hint')}")
        expect(dialog).toContain("label={t('attendance_mission_hours_pays')}")
        expect(dialog).toContain("MISSION_PAYS.map(")
        expect(dialog).toContain("t('attendance_mission_pays_none')")
    })

    it("asks what one day is worth once either kind pays, and the amount once it's an amount", () => {
        expect(dialog).toContain("const missionPays = m.days > 0 || m.hours > 0")
        expect(dialog).toContain("{missionPays && (")
        expect(dialog).toContain("label={t('attendance_mission_day_worth')}")
        expect(dialog).toContain("{ value: 'OWN_PAY', label: t('attendance_mission_worth_own') }")
        expect(dialog).toContain("{ value: 'AMOUNT', label: t('attendance_mission_worth_amount') }")
        expect(dialog).toContain("{missionPays && m.dayWorth === 'AMOUNT' && (")
        expect(dialog).toContain("label={t('attendance_mission_amount')}")
        expect(dialog).toContain("error={errorOf('missions.amount')}")
        expect(dialog).toContain('name="missions.amount"')
        expect(dialog).toContain('inputMode="decimal"')
    })

    it("shows them whether or not missions can be asked for", () => {
        // The switch changes asking alone: the allowance isn't inside it. Only how far back they may be asked for is
        // (LATER_CHANGES_PLAN.md §7.4, 4c), in a block of its own that closes before the allowance.
        expect(dialog).not.toMatch(/form\.missions\.enabled && \(/)
        const asking = dialog.indexOf("{m.enabled && (")
        expect(dialog.indexOf("{m.enabled && (", asking + 1)).toBe(-1)
        const closes = dialog.indexOf("\n                        )}", asking)
        expect(dialog.slice(asking, closes)).toContain("t('attendance_mission_days_back')")
        expect(dialog.slice(asking, closes)).not.toContain("attendance_mission_allowance")
        expect(closes).toBeLessThan(dialog.indexOf("t('attendance_mission_allowance')"))
    })
})

describe("the policy's card", () => {
    const panel = readFileSync("components/AttendancePolicyPanel.tsx", "utf8")

    it("says what each kind pays and what one day is worth, or that there's no allowance", () => {
        expect(panel).toContain("t('attendance_mission_allowance_none_line')")
        expect(panel).toContain("t('attendance_mission_days_line')")
        expect(panel).toContain("t('attendance_mission_hours_line')")
        expect(panel).toContain("t('attendance_mission_worth_own_line')")
        expect(panel).toContain("t('attendance_mission_worth_amount_line')")
        // Beside whether they can be asked for, which stays.
        expect(panel).toContain("shown.body.missions.enabled ? t('attendance_missions_line') : t('attendance_missions_off_line')")
    })
})

describe("each mission day priced (PR 287)", () => {
    const migration = readFileSync("prisma/migrations/20261226000000_mission_allowance_day/migration.sql", "utf8")
    const statements = migration.split("\n").filter(l => l.trim() && !l.startsWith("--")).join("\n")
    const service = readFileSync("lib/services/attendance-engine.service.ts", "utf8")
    const page = readFileSync("app/(dashboard)/dashboard/attendance/page.tsx", "utf8")

    it("is kept on the day by a migration that only adds a column, nothing on the days there before it", () => {
        expect(statements).toBe(`ALTER TABLE "AttendanceDay" ADD COLUMN "missionAllowanceMinor" INTEGER NOT NULL DEFAULT 0;`)
        expect(readFileSync("prisma/schema.prisma", "utf8")).toMatch(/model AttendanceDay \{[^}]*\n\s+missionAllowanceMinor\s+Int\s+@default\(0\)/)
    })

    it("follows the approved mission on that date, not how the day read, and never a date on leave or suspended", () => {
        expect(service).toContain("mission: onLeave || isSuspended ? null : missionOn.get(date) ?? null,")
        expect(service).toContain("row: { ...row, missionAllowanceMinor: d.missionAllowanceMinor },")
    })

    it("leaves a day with no allowance its hash, so no day is written again for the column alone", () => {
        expect(service).toContain("inputsHash: hashOf({ ...row, deductionDays: d.deductionDays, ...(d.missionAllowanceMinor ? { missionAllowanceMinor: d.missionAllowanceMinor } : {}) }),")
    })

    it("is hidden with the day's other money from whoever doesn't see that person's pay", () => {
        const days = readFileSync("app/api/attendance/days/route.ts", "utf8")
        expect(days).toContain("return seesPay ? d : { ...d, deductionMinor: null, overtimeMinor: null, missionAllowanceMinor: null }")
        const exceptions = readFileSync("app/api/attendance/exceptions/route.ts", "utf8")
        expect(exceptions).toContain("? d : { ...d, deductionMinor: null, overtimeMinor: null, missionAllowanceMinor: null })")
        // The two lists that send whole days on; every other reader picks its fields.
        const readers = ["lib/services/attendance-request.service.ts", "lib/services/attendance-payroll.ts", "lib/services/attendance-lock.ts", "lib/requests/feed.ts"]
        for (const file of readers) {
            const reads = readFileSync(file, "utf8").split("attendanceDay.find").slice(1)
            expect(reads.length, file).toBeGreaterThan(0)
            for (const read of reads) expect(read.slice(0, 600), file).toMatch(/\bselect: \{/)
        }
    })

    it("is shown on the day, in the table and on the card, with the amount in the page's digits", () => {
        expect(page).toContain("missionAllowanceMinor: number | null")
        expect(page).toContain("const allowance = (d: Day) => (d.missionAllowanceMinor ? <span>{t('day_mission_allowance')}: <bdi>{amount(d.missionAllowanceMinor)}</bdi></span> : null)")
        // Under the day's status in the table, and a line of its own on the card.
        expect(page).toContain("{allowance(d) && <div className=\"ui-item-detail\">{allowance(d)}</div>}")
        expect(page).toContain("...(d.missionAllowanceMinor ? [{ icon: CoinsIcon, text: allowance(d) }] : []),")
    })

    it("is in the month's totals once there is any: one person's month, and everyone's", () => {
        expect(page).toContain("...(!hidesMoney && allowanceMinor > 0 ? [{ label: t('day_mission_allowance'), value: amount(allowanceMinor) }] : []),")
        expect(page).toContain("...(allowanceTotal > 0 ? [{ label: t('day_total_mission_allowance'), value: amount(allowanceTotal) }] : []),")
    })

    it("has its words in both languages", () => {
        expect(en.day_mission_allowance).toBe("Mission allowance")
        expect(ar.day_mission_allowance).toBe("بدل المأمورية")
        expect(en.day_total_mission_allowance).toBe("Total mission allowance")
        expect(ar.day_total_mission_allowance).toBe("إجمالي بدل المأمورية")
    })
})

describe("paid with salary (PR 288)", () => {
    const migration = readFileSync("prisma/migrations/20261227000000_mission_allowance_paid/migration.sql", "utf8")
    const statements = migration.split("\n").filter(l => l.trim() && !l.startsWith("--")).join("\n")
    const payroll = readFileSync("lib/services/attendance-payroll.ts", "utf8")
    const register = readFileSync("lib/register.ts", "utf8")
    const page = readFileSync("app/(dashboard)/dashboard/payroll/page.tsx", "utf8")

    it("has its own category of attendance entry, by a migration that only adds it", () => {
        expect(statements).toBe(`ALTER TYPE "AttendanceCategory" ADD VALUE 'MISSION_ALLOWANCE';`)
        expect(readFileSync("prisma/schema.prisma", "utf8")).toMatch(/enum AttendanceCategory \{[^}]*\n\s+OVERTIME\n\s+MISSION_ALLOWANCE\n\}/)
    })

    it("is summed from the days as priced, never worked out again", () => {
        expect(payroll).toContain("select: { userId: true, status: true, deductionMinor: true, overtimeMinor: true, missionAllowanceMinor: true, breakdown: true },")
        expect(payroll).toContain("sum.missionAllowance += d.missionAllowanceMinor")
    })

    it("is an earning on the payslip, after overtime, traceable to its entry", () => {
        expect(register).toContain(`["MISSION_ALLOWANCE", "EARNING", "Mission allowance", a.missionAllowance],`)
        expect(register.indexOf(`["OVERTIME", "EARNING", "Overtime", a.overtime],`)).toBeLessThan(register.indexOf(`["MISSION_ALLOWANCE", "EARNING"`))
        expect(register.indexOf(`["MISSION_ALLOWANCE", "EARNING"`)).toBeLessThan(register.indexOf(`["LATENESS", "DEDUCTION"`))
    })

    it("is written at approval with the other attendance entries, and read back from the payslip's own line", () => {
        expect(payroll).toContain(`["MISSION_ALLOWANCE", "missionAllowance"],`)
        const run = readFileSync("lib/services/payroll-run.service.ts", "utf8")
        expect(run).toContain(`missionAllowance: of("MISSION_ALLOWANCE")`)
    })

    it("freezes a day with its allowance only where a payslip carried it: none in a dry run, none for someone left out (review on PR 288)", () => {
        // Cleared on the days being frozen now, for everyone but those paid, then stamped.
        // The payroll month's period since PR 430, not its calendar month.
        expect(payroll).toContain("export async function stampDays(tx: Db, companyId: string, period: Period, payrollRunId: string, allowancePaidTo: readonly string[]) {")
        expect(payroll).toContain("where: { ...freezing, missionAllowanceMinor: { gt: 0 }, ...(allowancePaidTo.length > 0 ? { userId: { notIn: [...allowancePaidTo] } } : {}) },")
        expect(payroll.indexOf("data: { missionAllowanceMinor: 0 },")).toBeLessThan(payroll.indexOf("data: { lockedByPayrollRunId: payrollRunId },"))
        // Approval names those paid from the payslips' own lines, and nobody when attendance doesn't reach payroll.
        const run = readFileSync("lib/services/payroll-run.service.ts", "utf8")
        expect(run).toContain("const allowancePaidTo = reaches ? people.filter(p => !p.excluded && p.attendance.missionAllowance > 0).map(p => p.userId) : []")
        expect(run).toContain("const daysLocked = await stampDays(tx, companyId, period, draft.id, allowancePaidTo)")
    })

    it("is named on Payroll's register, on the payslip's line and in what attendance puts there", () => {
        expect(en.attpay_line_MISSION_ALLOWANCE).toBe("Mission allowance")
        expect(ar.attpay_line_MISSION_ALLOWANCE).toBe("بدل المأمورية")
        // And wherever the audit log names the entry's category.
        expect(en.audit_value_MISSION_ALLOWANCE).toBe("Mission allowance")
        expect(ar.audit_value_MISSION_ALLOWANCE).toBe("بدل المأمورية")
        for (const words of [en, ar]) {
            for (const key of ["attpay_register_on", "attpay_register_on_approved", "attpay_hint"] as const) {
                expect(words[key], key).toContain(words === en ? "mission allowance" : "بدل المأمورية")
            }
        }
        expect(en.attpay_register_on).toBe("Attendance is on these payslips (from {month}): lateness, early leave and absence as deductions, approved overtime and the mission allowance as earnings.")
    })

    it("says in the dry run what the allowance would add, only when there is any, and counts it with each person's overtime", () => {
        expect(en.attpay_dry_allowance).toBe("It would also add {amount} of mission allowance.")
        expect(ar.attpay_dry_allowance).toBe("وكان سيضيف {amount} بدل مأمورية.")
        expect(page).toContain("{dryAllowance > 0 && <p>{t('attpay_dry_allowance').replace('{amount}', money(dryAllowance))}</p>}")
        expect(page).toContain("additions: m.overtime + (m.missionAllowance ?? 0)")
        expect(page).toContain(".filter(r => r.name && (r.deductions > 0 || r.additions > 0))")
    })
})

describe("across a closed month (PR 289)", () => {
    const migration = readFileSync("prisma/migrations/20261228000000_discrepancy_mission_allowance/migration.sql", "utf8")
    const statements = migration.split("\n").filter(l => l.trim() && !l.startsWith("--")).join("\n")
    const engine = readFileSync("lib/services/attendance-engine.service.ts", "utf8")
    const service = readFileSync("lib/services/attendance-discrepancy.service.ts", "utf8")
    const page = readFileSync("app/(dashboard)/dashboard/payroll/page.tsx", "utf8")

    it("keeps on a difference what the allowance was paid at and what it is now, by a migration that only adds two columns, empty on those recorded before", () => {
        expect(statements).toBe(`ALTER TABLE "AttendanceDiscrepancy" ADD COLUMN "paidAllowanceMinor" INTEGER, ADD COLUMN "nowAllowanceMinor" INTEGER;`)
        const schema = readFileSync("prisma/schema.prisma", "utf8")
        expect(schema).toMatch(/model AttendanceDiscrepancy \{[^}]*\n\s+paidAllowanceMinor\s+Int\?\n/)
        expect(schema).toMatch(/model AttendanceDiscrepancy \{[^}]*\n\s+nowAllowanceMinor\s+Int\?\n/)
    })

    it("sets the day's allowance, worked out again, beside what was paid, with its deduction and overtime", () => {
        // What was paid is read from the frozen day; what it is now, from the day derived again.
        expect(engine).toContain("select: { userId: true, date: true, status: true, deductionMinor: true, overtimeMinor: true, missionAllowanceMinor: true }")
        expect(engine).toContain("allowance: paidBy(userId, n?.missionAllowanceMinor ?? 0)")
        // Open, kept current and closed on all three.
        expect(engine).toContain("const back = current.deduction === r.paidDeductionMinor && current.overtime === r.paidOvertimeMinor && current.allowance === paidAllowance")
        expect(engine).toContain("if (base.deduction === current.deduction && base.overtime === current.overtime && base.allowance === current.allowance) continue")
        expect(engine).toContain("paidAllowanceMinor: base.allowance, nowAllowanceMinor: current.allowance,")
    })

    it("compares the allowance only for those the run paid: someone left out of it was paid none, and being left out is no change", () => {
        expect(engine).toContain("tx.payslip.findMany({ where: { payrollRunId: run.id, excluded: false, ...scope }, select: { userId: true } })")
        expect(engine).toContain("const paidBy = (userId: string, minor: number) => (paidPeople.has(userId) ? minor : 0)")
    })

    it("reads the allowance paid from the day for a difference recorded before the columns", () => {
        expect(engine).toContain("const paidAllowance = r.paidAllowanceMinor ?? frozen")
        expect(engine).toContain("allowance: last.nowAllowanceMinor ?? frozen")
    })

    it("counts the allowance in what a difference owes, nothing where it was recorded before", () => {
        expect(service).toContain("differenceMinor: (d.paidDeductionMinor - d.nowDeductionMinor) + (d.nowOvertimeMinor - d.paidOvertimeMinor) + allowanceMinor,")
        expect(service).toContain("const allowanceMinor = (d.nowAllowanceMinor ?? 0) - (d.paidAllowanceMinor ?? 0)")
    })

    it("says on the row how much more or less allowance than was paid, only where it is part of the difference", () => {
        expect(page).toContain("note={d.allowanceMinor ? t(d.allowanceMinor > 0 ? 'attpay_changed_allowance_more' : 'attpay_changed_allowance_less').replace('{amount}', money(Math.abs(d.allowanceMinor))) : undefined}")
        expect(en.attpay_changed_allowance_more).toBe("Mission allowance: {amount} more than paid")
        expect(en.attpay_changed_allowance_less).toBe("Mission allowance: {amount} less than paid")
        expect(ar.attpay_changed_allowance_more).toBe("بدل المأمورية: {amount} أكثر مما صُرف")
        expect(ar.attpay_changed_allowance_less).toBe("بدل المأمورية: {amount} أقل مما صُرف")
    })
})

describe("its words", () => {
    const keys = [
        "attendance_mission_allowance", "attendance_mission_allowance_hint",
        "attendance_mission_days_pays", "attendance_mission_days_pays_hint", "attendance_mission_hours_pays", "attendance_mission_pays_none",
        "attendance_mission_day_worth", "attendance_mission_worth_own", "attendance_mission_worth_amount", "attendance_mission_amount",
        "attendance_missions_off_line", "attendance_mission_allowance_none_line", "attendance_mission_days_line", "attendance_mission_hours_line",
        "attendance_mission_worth_own_line", "attendance_mission_worth_amount_line",
    ]

    it("are in both languages, and the typed parts the same in each", () => {
        const enw = en as Record<string, string>, arw = ar as Record<string, string>
        for (const key of keys) {
            expect(enw[key], key).toBeTruthy()
            expect(arw[key], key).toBeTruthy()
            const slots = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
            expect(slots(arw[key]), key).toEqual(slots(enw[key]))
        }
    })

    it("call it بدل المأمورية in Arabic, and name the currency with the amount", () => {
        expect(ar.attendance_mission_allowance).toBe("بدل المأمورية")
        expect(en.attendance_mission_allowance).toBe("Mission allowance (بدل مأمورية)")
        expect(en.attendance_mission_amount).toBe("Amount for one day (EGP)")
        expect(ar.attendance_mission_amount).toBe("مبلغ اليوم الواحد (ج.م)")
    })
})
