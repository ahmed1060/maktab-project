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
 * nothing to start. Pricing each day, paying it with salary and carrying it
 * across a closed month come in the PRs after.
 */

const withAllowance = (allowance: Partial<PolicyBody["missions"]["allowance"]>, enabled = true): PolicyBody => ({
    ...STANDARD_OFFICE, missions: { enabled, allowance: { ...NO_MISSION_ALLOWANCE, ...allowance } },
})
const parses = (allowance: object) => policyBodySchema.safeParse({ ...STANDARD_OFFICE, missions: { enabled: true, allowance: { ...NO_MISSION_ALLOWANCE, ...allowance } } }).success

describe("the allowance's settings (decisions 6 and 12, PR 286)", () => {
    it("start at nothing for both kinds, in every starting policy", () => {
        expect(NO_MISSION_ALLOWANCE).toEqual({ dayWorth: "OWN_PAY", amountMinor: 0, days: 0, hours: 0 })
        for (const body of [STANDARD_OFFICE, SIX_DAY_FACTORY, MEASURE_ONLY]) expect(body.missions).toEqual({ enabled: true, allowance: NO_MISSION_ALLOWANCE })
    })

    it("read as nothing in a version saved before them, so nothing is migrated", () => {
        // Saved by #283, with the switch alone.
        const off = policyBodySchema.parse({ ...STANDARD_OFFICE, missions: { enabled: false } })
        expect(off.missions).toEqual({ enabled: false, allowance: NO_MISSION_ALLOWANCE })
        // Saved before missions, with neither.
        const older: Record<string, unknown> = { ...STANDARD_OFFICE }
        delete older.missions
        expect(policyBodySchema.parse(older).missions).toEqual({ enabled: true, allowance: NO_MISSION_ALLOWANCE })
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
        expect(formFromBody(STANDARD_OFFICE).missions).toEqual({ enabled: true, dayWorth: "OWN_PAY", amount: "", days: 0, hours: 0 })
        expect(formOf({ dayWorth: "AMOUNT", amountMinor: 200_00, days: 1, hours: 0.5 }).missions).toEqual({ enabled: true, dayWorth: "AMOUNT", amount: "200", days: 1, hours: 0.5 })
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
            expect(out.ok && out.body.missions).toEqual({ enabled: false, allowance })
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
        expect(out.ok && out.body.missions).toEqual({ enabled: false, allowance: { dayWorth: "AMOUNT", amountMinor: 200_00, days: 1, hours: 0 } })
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
        // The switch changes asking alone: the allowance isn't inside it.
        expect(dialog).not.toMatch(/form\.missions\.enabled && \(/)
        expect(dialog).not.toMatch(/m\.enabled && \(/)
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
