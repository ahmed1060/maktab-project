import { z } from "zod"
import { DEFAULT_WORK_WEEK } from "./calendar"

/**
 * A company's attendance policy (ATTENDANCE_PLAN.md §6): what lateness, early
 * leave, overtime and absence cost, and how permission hours (إذن) work.
 *
 * Effective-dated like the schedules (§6.1): each version applies from a date,
 * and a day is measured against the version in force on it. Plain data and
 * pure functions here; the engine prices with them and the settings screen
 * edits them, so both read one definition.
 *
 * Money is not here. The policy speaks in fractions of a day and multipliers;
 * the engine turns those into money at the salary in force on the date
 * (§6.3), which is the only way a mid-month raise prices each day right.
 */

const minutes = z.number().int().min(0).max(24 * 60)

/**
 * One band: lateness in [fromMinutes, toMinutes] costs dayFraction of a day.
 * toMinutes null is "and over". A band always charges something: grace and
 * free occurrences are the ways to waive lateness, not a zero band.
 */
export const bandSchema = z.object({
    fromMinutes: minutes,
    toMinutes: minutes.nullable(),
    dayFraction: z.number().gt(0).max(1),
})

/**
 * Lateness and early leave share a shape (§6.3): a grace period, then either
 * bands or a per-minute charge at the daily rate, a number of free occurrences
 * a month, escalation for repeats, and a monthly cap.
 */
export const deductionRuleSchema = z.object({
    enabled: z.boolean(),
    graceMinutes: minutes,
    mode: z.enum(["BANDS", "PER_MINUTE"]),
    bands: z.array(bandSchema).max(10),
    /** Occurrences each month that cost nothing (after grace). */
    freePerMonth: z.number().int().min(0).max(31),
    /** From the Nth charged occurrence in a month, each costs `multiplier` times. Null: no escalation. */
    escalation: z.object({ fromOccurrence: z.number().int().min(1).max(31), multiplier: z.number().min(1).max(5) }).nullable(),
    /** At most this many days a month from this rule. Null: no cap. */
    monthlyCapDays: z.number().min(0).max(31).nullable(),
})

export const overtimeSchema = z.object({
    enabled: z.boolean(),
    /** Overtime shorter than this does not count. */
    minimumMinutes: minutes,
    /** Pay per overtime hour, as a multiple of the hourly rate, by kind of day. */
    multipliers: z.object({
        workday: z.number().min(1).max(5),
        restDay: z.number().min(1).max(5),
        holiday: z.number().min(1).max(5),
    }),
    /** Recorded but priced at zero until someone approves it (§6.4). */
    requiresApproval: z.boolean(),
    /** Banked time is planned; the field exists from the start (§6.4). */
    compensation: z.enum(["PAY", "BANK"]),
})

export const absenceSchema = z.object({
    /** Days deducted per unexcused absent day (§6.5): 1, 1.5, 2. */
    multiplier: z.number().min(0).max(3),
})

export const PERMISSION_TYPES = ["LATE_ARRIVAL", "EARLY_LEAVE", "MIDDAY"] as const

export const permissionHoursSchema = z.object({
    enabled: z.boolean(),
    monthlyAllowanceMinutes: z.number().int().min(0).max(60 * 60),
    minPerRequestMinutes: z.number().int().min(1).max(24 * 60),
    maxPerRequestMinutes: z.number().int().min(1).max(24 * 60),
    maxRequestsPerMonth: z.number().int().min(1).max(31).nullable(),
    /** 0: in advance only. Otherwise up to this many hours after the fact. */
    afterTheFactHours: z.number().int().min(0).max(24 * 7),
    carryOver: z.enum(["LAPSE", "CARRY_ONCE"]),
    types: z.array(z.enum(PERMISSION_TYPES)).min(1),
})

export const policyBodySchema = z.object({
    /** The company's working days, 0 = Sunday (§6.2). A schedule may differ. */
    workWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    lateness: deductionRuleSchema,
    earlyLeave: deductionRuleSchema,
    overtime: overtimeSchema,
    absence: absenceSchema,
    permissionHours: permissionHoursSchema,
    /** Minutes after a shift starts with no check-in before the reminder (§13.4). Null: off. */
    noCheckInReminderMinutes: z.number().int().min(1).max(240).nullable(),
    /**
     * Face verification can be asked of this company's people (§9.5). Only
     * while the system switch is on and the company has confirmed its legal
     * readiness (§10.4). Defaults off, which also reads versions saved before it existed.
     */
    faceVerificationAvailable: z.boolean().default(false),
    /** Re-verify each person's face every this many months; null: only on request (§9.5). */
    faceReverifyMonths: z.number().int().min(1).max(36).nullable().default(null),
})

export type Band = z.infer<typeof bandSchema>
export type DeductionRule = z.infer<typeof deductionRuleSchema>
export type PolicyBody = z.infer<typeof policyBodySchema>

/**
 * Why a policy cannot be used, or null. What zod cannot say alone: bands in
 * order without gaps or overlaps, per-request limits the right way round.
 */
export function policyProblem(body: PolicyBody): string | null {
    if (new Set(body.workWeek).size !== body.workWeek.length) return "WORK_WEEK_DUPLICATE_DAY"
    for (const rule of [body.lateness, body.earlyLeave]) {
        const problem = bandsProblem(rule)
        if (problem) return problem
    }
    const p = body.permissionHours
    if (p.minPerRequestMinutes > p.maxPerRequestMinutes) return "PERMISSION_LIMITS_REVERSED"
    if (p.enabled && p.maxPerRequestMinutes > p.monthlyAllowanceMinutes && p.monthlyAllowanceMinutes > 0) return "PERMISSION_REQUEST_OVER_ALLOWANCE"
    return null
}

/**
 * Bands must start right after the grace period, run in order, touch without
 * gap or overlap, and end open ("and over") — otherwise some lateness would
 * cost nothing by accident, or be charged twice.
 */
export function bandsProblem(rule: DeductionRule): string | null {
    if (!rule.enabled || rule.mode !== "BANDS") return null
    if (rule.bands.length === 0) return "BANDS_EMPTY"
    let expected = rule.graceMinutes + 1
    for (const [i, band] of rule.bands.entries()) {
        if (band.fromMinutes !== expected) return "BANDS_NOT_CONTIGUOUS"
        const last = i === rule.bands.length - 1
        if (band.toMinutes === null) {
            if (!last) return "BANDS_OPEN_BEFORE_END"
        } else {
            if (band.toMinutes < band.fromMinutes) return "BANDS_NOT_CONTIGUOUS"
            if (last) return "BANDS_NOT_OPEN_ENDED"
            expected = band.toMinutes + 1
        }
    }
    return null
}

/**
 * The fraction of a day a number of minutes late (or early) costs under a
 * rule, before the monthly rules (free occurrences, escalation, cap), which
 * depend on the order of the month and are the engine's (§11). Zero inside
 * grace. Per-minute mode charges every minute past grace at the daily rate,
 * over the shift's paid minutes.
 */
export function dayFractionFor(rule: DeductionRule, lateMinutes: number, paidShiftMinutes: number): number {
    if (!rule.enabled || lateMinutes <= rule.graceMinutes) return 0
    if (rule.mode === "PER_MINUTE") {
        if (paidShiftMinutes <= 0) return 0
        return Math.min(1, (lateMinutes - rule.graceMinutes) / paidShiftMinutes)
    }
    const band = rule.bands.find(b => lateMinutes >= b.fromMinutes && (b.toMinutes === null || lateMinutes <= b.toMinutes))
    return band?.dayFraction ?? 0
}

const OFF_RULE: DeductionRule = {
    enabled: false, graceMinutes: 0, mode: "BANDS", bands: [], freePerMonth: 0, escalation: null, monthlyCapDays: null,
}

/**
 * The starting templates (§6.8). Applying one copies its values; the company's
 * policy is never linked to it, so editing a template re-prices nobody.
 */
export const STANDARD_OFFICE: PolicyBody = {
    workWeek: [...DEFAULT_WORK_WEEK],
    lateness: {
        enabled: true, graceMinutes: 15, mode: "BANDS",
        bands: [
            { fromMinutes: 16, toMinutes: 30, dayFraction: 0.25 },
            { fromMinutes: 31, toMinutes: 60, dayFraction: 0.5 },
            { fromMinutes: 61, toMinutes: null, dayFraction: 1 },
        ],
        freePerMonth: 2, escalation: null, monthlyCapDays: 3,
    },
    earlyLeave: {
        enabled: true, graceMinutes: 10, mode: "BANDS",
        bands: [
            { fromMinutes: 11, toMinutes: 30, dayFraction: 0.25 },
            { fromMinutes: 31, toMinutes: 60, dayFraction: 0.5 },
            { fromMinutes: 61, toMinutes: null, dayFraction: 1 },
        ],
        freePerMonth: 0, escalation: null, monthlyCapDays: 3,
    },
    // Starting values for a company to confirm against the labour law's
    // overtime floors, not a statement of them.
    overtime: { enabled: true, minimumMinutes: 30, multipliers: { workday: 1.35, restDay: 2, holiday: 3 }, requiresApproval: true, compensation: "PAY" },
    absence: { multiplier: 1 },
    permissionHours: {
        enabled: true, monthlyAllowanceMinutes: 240, minPerRequestMinutes: 30, maxPerRequestMinutes: 120,
        maxRequestsPerMonth: 4, afterTheFactHours: 24, carryOver: "LAPSE", types: [...PERMISSION_TYPES],
    },
    noCheckInReminderMinutes: 15,
    faceVerificationAvailable: false,
    faceReverifyMonths: null,
}

export const SIX_DAY_FACTORY: PolicyBody = {
    ...STANDARD_OFFICE,
    workWeek: [6, 0, 1, 2, 3, 4],
    lateness: { ...STANDARD_OFFICE.lateness, graceMinutes: 5, bands: [
        { fromMinutes: 6, toMinutes: 15, dayFraction: 0.25 },
        { fromMinutes: 16, toMinutes: 30, dayFraction: 0.5 },
        { fromMinutes: 31, toMinutes: null, dayFraction: 1 },
    ], freePerMonth: 0 },
    permissionHours: { ...STANDARD_OFFICE.permissionHours, monthlyAllowanceMinutes: 120, maxPerRequestMinutes: 60, maxRequestsPerMonth: 2 },
}

/** Measured, never priced: what a company has before it sets a policy. */
export const MEASURE_ONLY: PolicyBody = {
    workWeek: [...DEFAULT_WORK_WEEK],
    lateness: OFF_RULE,
    earlyLeave: OFF_RULE,
    overtime: { enabled: false, minimumMinutes: 0, multipliers: { workday: 1, restDay: 1, holiday: 1 }, requiresApproval: true, compensation: "PAY" },
    absence: { multiplier: 0 },
    permissionHours: {
        enabled: false, monthlyAllowanceMinutes: 0, minPerRequestMinutes: 30, maxPerRequestMinutes: 120,
        maxRequestsPerMonth: null, afterTheFactHours: 0, carryOver: "LAPSE", types: [...PERMISSION_TYPES],
    },
    noCheckInReminderMinutes: null,
    faceVerificationAvailable: false,
    faceReverifyMonths: null,
}

export type PolicyVersion = { id: string; effectiveFrom: string; body: PolicyBody }

/** The version in force on a date, or null before the first. */
export function policyOn(versions: readonly PolicyVersion[], date: string): PolicyVersion | null {
    let best: PolicyVersion | null = null
    for (const v of versions) if (v.effectiveFrom <= date && (!best || v.effectiveFrom > best.effectiveFrom)) best = v
    return best
}

/** The company's work week on a date: its policy's, or Sunday to Thursday before it has one. */
export function workWeekOn(versions: readonly PolicyVersion[], date: string): number[] {
    return [...(policyOn(versions, date)?.body.workWeek ?? DEFAULT_WORK_WEEK)]
}
