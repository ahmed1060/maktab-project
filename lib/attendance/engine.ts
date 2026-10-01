import type { ExpectedDay } from "./calendar"
import { dayFractionFor, type DeductionRule, type PolicyBody } from "./policy"

/**
 * The derivation engine (ATTENDANCE_PLAN.md §11): from what each day was meant
 * to be and the punches that arrived, what each day was — and then, over the
 * month in order, what it costs. Pure: the recompute service loads the inputs
 * and stores the outputs, so every rule here can be read and tested alone.
 *
 * Measured facts and priced outcomes are kept apart (§11). Measuring a day
 * needs only that day; pricing needs the month, because free occurrences,
 * escalation and the monthly cap depend on what came before.
 *
 * A missing punch is never guessed. An odd number of punches on a day makes it
 * INCOMPLETE: shown, measured as far as it goes, priced at nothing until
 * somebody adds the missing one.
 */

/** A punch as the engine reads it: the wall-clock time where it happened. */
export type EnginePunch = { id: string; at: string; direction: "IN" | "OUT" | null }

export type DayStatus =
    | "PRESENT" | "ABSENT" | "INCOMPLETE" | "LEAVE" | "SUSPENDED"
    | "REST" | "HOLIDAY" | "WORKED_REST_DAY" | "WORKED_HOLIDAY" | "NO_SCHEDULE"

/** Arrivals this long before a shift, and leavings this long after it, still belong to it. */
export const EARLY_MARGIN_MINUTES = 4 * 60
export const LATE_MARGIN_MINUTES = 6 * 60
/** Two scans this close together are one (§11): a finger held twice, not two events. */
export const DEBOUNCE_SECONDS = 60
/** Paid minutes assumed for a day with no shift of its own, to price overtime on a rest day. */
export const FALLBACK_PAID_MINUTES = 8 * 60

const DAY_MS = 86_400_000

/** Days since 1970-01-01 for a "YYYY-MM-DD". */
export function dayNumber(date: string): number {
    return Math.round(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS)
}

/** Seconds since 1970-01-01T00:00 for a wall-clock "YYYY-MM-DDTHH:MM:SS", zone-free. */
export function wallSeconds(local: string): number {
    return Math.round(Date.UTC(
        Number(local.slice(0, 4)), Number(local.slice(5, 7)) - 1, Number(local.slice(8, 10)),
        Number(local.slice(11, 13)), Number(local.slice(14, 16)), Number(local.slice(17, 19) || 0),
    ) / 1000)
}

/** The planned shift of a working day, in seconds on the same zone-free clock. */
function shiftOf(date: string, expected: ExpectedDay): { start: number; end: number } | null {
    if (expected.kind !== "WORK") return null
    const base = dayNumber(date) * 86_400
    return { start: base + expected.hours.startMinutes * 60, end: base + expected.hours.endMinutes * 60 }
}

/**
 * Which date each punch belongs to: the working day whose shift (with its
 * margins) contains it, the nearest shift when two windows overlap, else the
 * calendar date it fell on. This is what keeps a night shift's 05:58 check-out
 * on the night it started (§11: grouped by shift instance).
 */
export function assignPunches(punches: readonly EnginePunch[], plans: ReadonlyMap<string, ExpectedDay>): Map<string, EnginePunch[]> {
    const shifts = [...plans].flatMap(([date, expected]) => {
        const s = shiftOf(date, expected)
        return s ? [{ date, ...s }] : []
    })
    const out = new Map<string, EnginePunch[]>()
    for (const punch of punches) {
        const t = wallSeconds(punch.at)
        let best: { date: string; distance: number } | null = null
        for (const s of shifts) {
            if (t < s.start - EARLY_MARGIN_MINUTES * 60 || t > s.end + LATE_MARGIN_MINUTES * 60) continue
            const distance = t < s.start ? s.start - t : t > s.end ? t - s.end : 0
            if (!best || distance < best.distance) best = { date: s.date, distance }
        }
        const date = best?.date ?? punch.at.slice(0, 10)
        out.set(date, [...(out.get(date) ?? []), punch])
    }
    for (const list of out.values()) list.sort((a, b) => wallSeconds(a.at) - wallSeconds(b.at))
    return out
}

/** Drops a scan within a minute of the one kept before it. Input in time order. */
export function debounce(punches: readonly EnginePunch[]): EnginePunch[] {
    const kept: EnginePunch[] = []
    for (const p of punches) {
        const last = kept.at(-1)
        if (last && wallSeconds(p.at) - wallSeconds(last.at) < DEBOUNCE_SECONDS) continue
        kept.push(p)
    }
    return kept
}

/** Punches taken two by two in sequence, as [in, out] seconds; an odd last one is left out. */
function pairs(punches: readonly EnginePunch[]): [number, number][] {
    const out: [number, number][] = []
    for (let i = 0; i + 1 < punches.length; i += 2) out.push([wallSeconds(punches[i].at), wallSeconds(punches[i + 1].at)])
    return out
}

export type MeasuredDay = {
    date: string
    status: DayStatus
    punchCount: number
    firstIn: string | null
    lastOut: string | null
    workedMinutes: number
    lateMinutes: number
    earlyLeaveMinutes: number
    overtimeMinutes: number
    /** Minutes of approved permission hours that covered lateness or early leave (§6.6). */
    excusedMinutes: number
    /** A company holiday it does not pay for: a day off, and a day's pay less (review on #13). */
    unpaidHoliday: boolean
    /** An absence somebody excused (§13.1): measured as absent, never charged. */
    excusedAbsence: boolean
}

export type PermissionSpan = { type: "LATE_ARRIVAL" | "EARLY_LEAVE" | "MIDDAY"; startMinutes: number; endMinutes: number }

/**
 * The minutes of a stretch of lateness or early leave that approved
 * permissions of one kind cover: only where their times overlap it, so an
 * hour approved for noon excuses nothing of a 09:00 lateness (review on #14).
 * Overlapping permissions count once.
 */
function coveredMinutes(date: string, permissions: readonly PermissionSpan[], type: PermissionSpan["type"], from: number, to: number): number {
    const base = dayNumber(date) * 86_400
    const spans = permissions.filter(p => p.type === type)
        .map(p => [Math.max(from, base + p.startMinutes * 60), Math.min(to, base + p.endMinutes * 60)] as const)
        .filter(([a, b]) => b > a)
        .sort((x, y) => x[0] - y[0])
    let covered = 0, reach = from
    for (const [a, b] of spans) {
        const start = Math.max(a, reach)
        if (b > start) { covered += b - start; reach = b }
    }
    return Math.floor(covered / 60)
}

/**
 * What one day was, from what it was meant to be and its punches.
 *
 * Pairs are taken in sequence, first with second and third with fourth —
 * never the earliest and latest (§11), so a lunch-break out and in is not
 * counted as work. Lateness runs from the shift's start to the first punch;
 * early leave from the last punch to the shift's end; overtime is work past
 * the shift's end. Work on a rest day or holiday is all overtime.
 */
export function measureDay(input: {
    date: string
    expected: ExpectedDay
    punches: readonly EnginePunch[]
    onLeave: boolean
    suspended: boolean
    /** Approved permission hours that day (P0.6), in minutes from the day's midnight. */
    permissions?: readonly PermissionSpan[]
    /** What somebody excused outright on the exceptions screen (§13.1), whatever its length. */
    excused?: { lateness?: boolean; earlyLeave?: boolean; absence?: boolean }
}): MeasuredDay {
    const { date, expected } = input
    const punches = debounce(input.punches)
    const firstIn = punches[0]?.at ?? null
    const lastOut = punches.length >= 2 ? punches.at(-1)!.at : null
    const base: MeasuredDay = {
        date, status: "ABSENT", punchCount: punches.length, firstIn, lastOut,
        workedMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, excusedMinutes: 0,
        unpaidHoliday: false, excusedAbsence: false,
    }
    const worked = pairs(punches).reduce((sum, [a, b]) => sum + (b - a), 0)
    const workedMinutes = Math.floor(worked / 60)
    const odd = punches.length % 2 === 1

    if (input.suspended) return { ...base, status: "SUSPENDED" }
    if (expected.kind === "NO_SCHEDULE") return { ...base, status: "NO_SCHEDULE", workedMinutes }
    if (expected.kind === "REST" || expected.kind === "HOLIDAY") {
        if (punches.length === 0) return { ...base, status: expected.kind, unpaidHoliday: expected.kind === "HOLIDAY" && !expected.holiday.isPaid }
        if (odd) return { ...base, status: "INCOMPLETE", lastOut: null }
        return { ...base, status: expected.kind === "REST" ? "WORKED_REST_DAY" : "WORKED_HOLIDAY", workedMinutes, overtimeMinutes: workedMinutes }
    }
    if (input.onLeave) return { ...base, status: "LEAVE" }
    if (punches.length === 0) return { ...base, excusedAbsence: !!input.excused?.absence }

    const shift = shiftOf(date, expected)!
    const lateRaw = Math.max(0, Math.floor((wallSeconds(firstIn!) - shift.start) / 60))
    const excusedLate = input.excused?.lateness ? lateRaw
        : Math.min(lateRaw, coveredMinutes(date, input.permissions ?? [], "LATE_ARRIVAL", shift.start, wallSeconds(firstIn!)))
    if (odd) return { ...base, status: "INCOMPLETE", lastOut: null, lateMinutes: lateRaw - excusedLate, excusedMinutes: excusedLate }

    const out = wallSeconds(lastOut!)
    const earlyRaw = Math.max(0, Math.floor((shift.end - out) / 60))
    const excusedEarly = input.excused?.earlyLeave ? earlyRaw
        : Math.min(earlyRaw, coveredMinutes(date, input.permissions ?? [], "EARLY_LEAVE", out, shift.end))
    return {
        ...base,
        status: "PRESENT",
        workedMinutes,
        lateMinutes: lateRaw - excusedLate,
        earlyLeaveMinutes: earlyRaw - excusedEarly,
        // Only time actually worked past the shift's end: the sum of each
        // pair's part after it, so a gap between leaving and coming back is
        // not overtime (review on #13).
        overtimeMinutes: Math.floor(pairs(punches).reduce((sum, [a, b]) => sum + Math.max(0, b - Math.max(a, shift.end)), 0) / 60),
        excusedMinutes: excusedLate + excusedEarly,
    }
}

// --- Pricing -----------------------------------------------------------------

/** Why a rule charged what it did, in the words the payslip will use (§13.3). */
export type RuleOutcome = {
    minutes: number
    /** The fraction of a day charged, after the monthly rules. */
    days: number
    /** The day's place among the month's occurrences past grace; 0 when within grace. */
    occurrence: number
    note: "WITHIN_GRACE" | "FREE_OCCURRENCE" | "CHARGED" | "ESCALATED" | "CAPPED" | "OFF" | null
}

export type PricedDay = MeasuredDay & {
    lateness: RuleOutcome
    earlyLeave: RuleOutcome
    absenceDays: number
    /** Days deducted in all: lateness + early leave + absence. */
    deductionDays: number
    deductionMinor: number
    overtimeStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED" | "NOT_COUNTED"
    overtimeMinor: number
    /** Why nothing was priced, when nothing could be. */
    unpriced: "NO_POLICY" | "NO_SALARY" | "INCOMPLETE" | null
}

export type PricingInput = {
    day: MeasuredDay
    /** The policy in force that day; null before the company has one (measured, never priced). */
    policy: PolicyBody | null
    /** The monthly salary in force that day, in minor units; null when there is none. */
    monthlyMinor: number | null
    /** Days in that date's month: a day is a 1/n of that month's salary (lib/payroll.ts). */
    daysInMonth: number
    /** The shift's paid minutes, which an hour of overtime is a fraction of. */
    paidMinutes: number
    /**
     * Somebody's decision on the day's overtime (P0.6): approved for some
     * minutes, or rejected. Read only when the policy requires approval.
     */
    overtimeDecision?: { status: "APPROVED" | "REJECTED"; minutes: number } | null
}

const roundHalfUp = (v: number) => Math.sign(v) * Math.round(Math.abs(v))
const NO_RULE: RuleOutcome = { minutes: 0, days: 0, occurrence: 0, note: null }

/** Running counts for one rule over a month: occurrences past grace and days charged. */
type Tally = { occurrences: number; charged: number }

function applyRule(rule: DeductionRule, minutes: number, paidMinutes: number, tally: Tally): RuleOutcome {
    if (!rule.enabled) return { minutes, days: 0, occurrence: 0, note: minutes > 0 ? "OFF" : null }
    if (minutes <= rule.graceMinutes) return { minutes, days: 0, occurrence: 0, note: minutes > 0 ? "WITHIN_GRACE" : null }
    tally.occurrences += 1
    const occurrence = tally.occurrences
    if (occurrence <= rule.freePerMonth) return { minutes, days: 0, occurrence, note: "FREE_OCCURRENCE" }
    let days = dayFractionFor(rule, minutes, paidMinutes)
    let note: RuleOutcome["note"] = "CHARGED"
    // Escalation counts the occurrences that are charged, after the free ones.
    if (rule.escalation && occurrence - rule.freePerMonth >= rule.escalation.fromOccurrence) {
        days *= rule.escalation.multiplier
        note = "ESCALATED"
    }
    if (rule.monthlyCapDays !== null && tally.charged + days > rule.monthlyCapDays) {
        days = Math.max(0, rule.monthlyCapDays - tally.charged)
        note = "CAPPED"
    }
    days = Math.round(days * 10_000) / 10_000
    tally.charged += days
    return { minutes, days, occurrence, note }
}

/**
 * Prices one person's month, its days in date order (§6.3–6.5, §11).
 *
 * Money is computed per day at that day's salary — a day is a 1/n of the
 * monthly salary in force on it, n the month's length, as payroll values days
 * (lib/payroll.ts) — so a deduction from before a mid-month raise is priced at
 * the old salary. Overtime is per hour of the day's paid minutes, times the
 * multiplier for the kind of day; when the policy requires approval it is
 * priced only as far as somebody approved it.
 */
export function priceMonth(days: readonly PricingInput[]): PricedDay[] {
    const lateTally: Tally = { occurrences: 0, charged: 0 }
    const earlyTally: Tally = { occurrences: 0, charged: 0 }
    return [...days].sort((a, b) => a.day.date.localeCompare(b.day.date)).map(input => {
        const { day, policy, monthlyMinor } = input
        const none: PricedDay = {
            ...day, lateness: NO_RULE, earlyLeave: NO_RULE, absenceDays: 0, deductionDays: 0, deductionMinor: 0,
            overtimeStatus: "NONE", overtimeMinor: 0, unpriced: null,
        }
        if (day.status === "INCOMPLETE") return { ...none, unpriced: "INCOMPLETE" }
        if (!policy) return { ...none, unpriced: "NO_POLICY" }

        const lateness = day.status === "PRESENT" ? applyRule(policy.lateness, day.lateMinutes, input.paidMinutes, lateTally) : NO_RULE
        const earlyLeave = day.status === "PRESENT" ? applyRule(policy.earlyLeave, day.earlyLeaveMinutes, input.paidMinutes, earlyTally) : NO_RULE
        // An absence costs the policy's multiplier; an unpaid holiday, one day.
        const absenceDays = day.status === "ABSENT" ? (day.excusedAbsence ? 0 : policy.absence.multiplier) : day.unpaidHoliday ? 1 : 0
        const deductionDays = Math.round((lateness.days + earlyLeave.days + absenceDays) * 10_000) / 10_000

        const ot = policy.overtime
        const countable = ot.enabled && day.overtimeMinutes > 0 && day.overtimeMinutes >= ot.minimumMinutes
        const overtimeStatus: PricedDay["overtimeStatus"] = day.overtimeMinutes === 0 ? "NONE"
            : !countable ? "NOT_COUNTED"
                : ot.requiresApproval ? (input.overtimeDecision?.status ?? "PENDING") : "APPROVED"
        const approved = input.overtimeDecision?.status === "APPROVED" ? input.overtimeDecision.minutes : 0
        const pricedOvertime = !countable ? 0 : ot.requiresApproval ? Math.min(day.overtimeMinutes, approved) : day.overtimeMinutes
        const multiplier = day.status === "WORKED_HOLIDAY" ? ot.multipliers.holiday : day.status === "WORKED_REST_DAY" ? ot.multipliers.restDay : ot.multipliers.workday

        if (monthlyMinor === null) {
            return { ...none, lateness, earlyLeave, absenceDays, deductionDays, overtimeStatus, unpriced: "NO_SALARY" }
        }
        const dayMinor = monthlyMinor / input.daysInMonth
        const paid = input.paidMinutes > 0 ? input.paidMinutes : FALLBACK_PAID_MINUTES
        return {
            ...none, lateness, earlyLeave, absenceDays, deductionDays, overtimeStatus,
            deductionMinor: roundHalfUp(dayMinor * deductionDays),
            overtimeMinor: roundHalfUp(dayMinor * (pricedOvertime / paid) * multiplier),
        }
    })
}

/** A day's paid minutes: its shift less the break, or the fallback when it has none. */
export function paidMinutesOf(expected: ExpectedDay, fallback: { startMinutes: number; endMinutes: number; breakMinutes: number } | null): number {
    const h = expected.kind === "WORK" ? expected.hours : fallback
    if (!h) return FALLBACK_PAID_MINUTES
    return Math.max(1, h.endMinutes - h.startMinutes - h.breakMinutes)
}
