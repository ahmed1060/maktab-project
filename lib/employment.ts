import { calendarParts, startOfMonthIn, startOfDayIn, DEFAULT_TIME_ZONE } from "./time"
import {
    daysInMonth,
    splitMonth,
    valueSegment,
    type Minor,
    type RateChange,
} from "./payroll"

/**
 * Whether somebody was employed, and whether they were working, across a month.
 *
 * The companion to salary-history.ts. That one answers "what were they paid";
 * this one answers "for which days". Both have to be read from events rather
 * than from User.status, because a status field says what is true now and says
 * nothing about March — and a payslip for March is a statement about March.
 *
 * Pure, for the same reason as payroll.ts: every interesting mistake here is a
 * boundary. A contract that ends on the 1st, a suspension that starts before
 * the month and ends inside it, a reinstatement dated back to the day of the
 * end. None of those need a database to get wrong.
 */

export type EmploymentEventType =
    | "HIRED"
    | "SUSPENDED"
    | "UNSUSPENDED"
    | "CONTRACT_ENDED"
    | "REINSTATED"

/** A row as stored, narrowed to what the calculation needs. */
export interface EmploymentEventRow {
    type: EmploymentEventType
    effectiveFrom: Date
    reason?: string | null
    /** UNSUSPENDED only. Null means the question has not been answered yet. */
    deductSuspension?: boolean | null
    /** Breaks ties when two events share an effective instant. */
    createdAt?: Date
}

/** A stretch of time, half-open: `from` is included, `to` is not. */
export interface Span {
    from: Date
    /** Null means still open — no end has been recorded. */
    to: Date | null
}

export interface SuspensionSpan extends Span {
    /**
     * Whether this suspension costs pay. Null means undecided: the suspension
     * is still running, or it ended without anyone answering the question.
     */
    deduct: boolean | null
    reason?: string
}

/** Inclusive, 1-based, the way everybody states a range of days. */
export interface DayRange {
    fromDay: number
    toDay: number
}

export interface SuspensionDays extends DayRange {
    deduct: boolean | null
    reason?: string
}

export interface MonthTimeline {
    year: number
    /** 1-12. */
    month: number
    /** Empty when they were not employed at all this month. */
    employed: DayRange[]
    /** Clipped to the employed days: a suspension outside employment is noise. */
    suspensions: SuspensionDays[]
}

/** Effective-date order, with the later-written row breaking a tie. */
function inOrder(events: EmploymentEventRow[]): EmploymentEventRow[] {
    return [...events].sort((a, b) => {
        const byDate = a.effectiveFrom.getTime() - b.effectiveFrom.getTime()
        if (byDate !== 0) return byDate
        return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)
    })
}

/**
 * The stretches of time somebody was employed.
 *
 * HIRED and REINSTATED open a stretch; CONTRACT_ENDED closes one. Touching
 * stretches are merged, which is what makes a reinstatement dated to the
 * instant of the end read as continuous employment rather than as two
 * employments with a zero-length gap between them — and a zero-length gap is
 * the sort of thing that shows up later as a duplicated day or a missing one.
 *
 * An event that repeats a state it is already in is ignored rather than
 * rejected. Two HIRED rows in a row are a data-entry artefact, not a second
 * employment, and refusing to compute a payslip over one would be a hard
 * failure caused by a soft problem.
 */
export function employmentSpans(events: EmploymentEventRow[]): Span[] {
    const spans: Span[] = []
    let openedAt: Date | null = null

    for (const event of inOrder(events)) {
        if (event.type === "HIRED" || event.type === "REINSTATED") {
            if (openedAt === null) openedAt = event.effectiveFrom
            continue
        }
        if (event.type === "CONTRACT_ENDED" && openedAt !== null) {
            if (event.effectiveFrom.getTime() > openedAt.getTime()) {
                spans.push({ from: openedAt, to: event.effectiveFrom })
            }
            openedAt = null
        }
    }

    if (openedAt !== null) spans.push({ from: openedAt, to: null })

    // Merge anything that touches or overlaps.
    const merged: Span[] = []
    for (const span of spans) {
        const previous = merged[merged.length - 1]
        if (previous && previous.to !== null && previous.to.getTime() >= span.from.getTime()) {
            previous.to = span.to === null
                ? null
                : new Date(Math.max(previous.to.getTime(), span.to.getTime()))
            continue
        }
        merged.push({ ...span })
    }
    return merged
}

/**
 * The stretches of time somebody was suspended.
 *
 * The deduct decision lives on the UNSUSPENDED event, not the SUSPENDED one,
 * because that is when it gets made. Suspension in this system only stops
 * somebody logging in; whether it costs them pay is a judgement the admin makes
 * once they know why it happened, which is usually at the end of it.
 *
 * A contract ending closes any suspension still open — you cannot be suspended
 * from a job you no longer hold — and that closure is always undecided, since
 * nobody answered the question.
 */
export function suspensionSpans(events: EmploymentEventRow[]): SuspensionSpan[] {
    const spans: SuspensionSpan[] = []
    let open: SuspensionSpan | null = null

    for (const event of inOrder(events)) {
        if (event.type === "SUSPENDED") {
            if (open === null) {
                open = { from: event.effectiveFrom, to: null, deduct: null, reason: event.reason ?? undefined }
            }
            continue
        }
        if (event.type === "UNSUSPENDED" && open !== null) {
            if (event.effectiveFrom.getTime() > open.from.getTime()) {
                open.to = event.effectiveFrom
                open.deduct = event.deductSuspension ?? null
                spans.push(open)
            }
            open = null
            continue
        }
        if (event.type === "CONTRACT_ENDED" && open !== null) {
            if (event.effectiveFrom.getTime() > open.from.getTime()) {
                open.to = event.effectiveFrom
                spans.push(open)
            }
            open = null
        }
    }

    if (open !== null) spans.push(open)
    return spans
}

/** The month's own bounds as instants: [start, end). */
function monthBounds(year: number, month: number, timeZone: string): { start: Date; end: Date } {
    // Midday, so the instant is safely inside the intended month in any zone.
    const start = startOfMonthIn(new Date(Date.UTC(year, month - 1, 1, 12)), timeZone)
    const nextYear = month === 12 ? year + 1 : year
    const nextMonth = month === 12 ? 1 : month + 1
    const end = startOfMonthIn(new Date(Date.UTC(nextYear, nextMonth - 1, 1, 12)), timeZone)
    return { start, end }
}

function isLocalMidnight(instant: Date, timeZone: string): boolean {
    return startOfDayIn(instant, timeZone).getTime() === instant.getTime()
}

/**
 * A span of instants as days of the month, counting any day it touches.
 *
 * Employment rounds outward: a contract that ends at 09:00 on the 10th means
 * the 10th was worked, and a person who joins at 16:00 on the 3rd is employed
 * on the 3rd. Nobody loses a day they were present for.
 */
function employedDays(
    span: Span, year: number, month: number, timeZone: string,
): DayRange | null {
    const { start, end } = monthBounds(year, month, timeZone)
    const length = daysInMonth(year, month)

    if (span.from.getTime() >= end.getTime()) return null
    if (span.to !== null && span.to.getTime() <= start.getTime()) return null

    const fromDay = span.from.getTime() <= start.getTime()
        ? 1
        : calendarParts(span.from, timeZone).day
    const toDay = span.to === null || span.to.getTime() >= end.getTime()
        ? length
        // `to` is exclusive, so the last employed instant is a millisecond earlier.
        : calendarParts(new Date(span.to.getTime() - 1), timeZone).day

    return fromDay <= toDay ? { fromDay, toDay } : null
}

/**
 * A span of instants as days of the month, counting only whole days.
 *
 * Suspension rounds inward, the mirror of the rule above and for the same
 * reason: a suspension starting at 14:00 on the 5th does not cost the 5th, and
 * one lifted at 10:00 on the 8th does not cost the 8th. Both conventions round
 * in the employee's favour, which is the only pair that cannot double-count —
 * a day can never be both unpaid for absence and unpaid for suspension.
 */
function suspendedDays(
    span: Span, year: number, month: number, timeZone: string,
): DayRange | null {
    const { start, end } = monthBounds(year, month, timeZone)
    const length = daysInMonth(year, month)

    if (span.from.getTime() >= end.getTime()) return null
    if (span.to !== null && span.to.getTime() <= start.getTime()) return null

    let fromDay: number
    if (span.from.getTime() <= start.getTime()) {
        fromDay = 1
    } else {
        const day = calendarParts(span.from, timeZone).day
        fromDay = isLocalMidnight(span.from, timeZone) ? day : day + 1
    }

    let toDay: number
    if (span.to === null || span.to.getTime() >= end.getTime()) {
        toDay = length
    } else {
        const lastTouched = calendarParts(new Date(span.to.getTime() - 1), timeZone).day
        toDay = isLocalMidnight(span.to, timeZone) ? lastTouched : lastTouched - 1
    }

    if (fromDay > length || toDay < 1 || fromDay > toDay) return null
    return { fromDay, toDay }
}

function overlap(a: DayRange, b: DayRange): DayRange | null {
    const fromDay = Math.max(a.fromDay, b.fromDay)
    const toDay = Math.min(a.toDay, b.toDay)
    return fromDay <= toDay ? { fromDay, toDay } : null
}

/**
 * One month of somebody's employment, in days.
 *
 * This is what the payroll calculation consumes: `employed` gives the windows
 * to pay for, and `suspensions` gives the stretches inside them that may not be
 * paid. Both are ranges of days rather than instants, because a payslip line
 * says "1-15", and a calculation that works in instants has to invent that
 * conversion somewhere anyway. Doing it once, here, means every feature that
 * values part of a month agrees about which days those are.
 */
export function timelineForMonth(
    events: EmploymentEventRow[],
    year: number,
    month: number,
    timeZone: string = DEFAULT_TIME_ZONE,
): MonthTimeline {
    const employed = employmentSpans(events)
        .map(span => employedDays(span, year, month, timeZone))
        .filter((range): range is DayRange => range !== null)

    const suspensions: SuspensionDays[] = []
    for (const span of suspensionSpans(events)) {
        const days = suspendedDays(span, year, month, timeZone)
        if (!days) continue
        for (const window of employed) {
            const clipped = overlap(days, window)
            if (clipped) suspensions.push({ ...clipped, deduct: span.deduct, reason: span.reason })
        }
    }

    return { year, month, employed, suspensions }
}

/** Was this person employed for every day of the month? */
export function employedWholeMonth(timeline: MonthTimeline): boolean {
    const length = daysInMonth(timeline.year, timeline.month)
    return timeline.employed.length === 1
        && timeline.employed[0].fromDay === 1
        && timeline.employed[0].toDay === length
}

function countDays(ranges: DayRange[]): number {
    const seen = new Set<number>()
    for (const range of ranges) {
        for (let day = range.fromDay; day <= range.toDay; day++) seen.add(day)
    }
    return seen.size
}

/** Days that a decided suspension takes out of the pay. */
export function deductedDays(timeline: MonthTimeline): number {
    return countDays(timeline.suspensions.filter(s => s.deduct === true))
}

/**
 * Days sitting under a suspension nobody has ruled on.
 *
 * Paid, for now — an unanswered question must not quietly become a deduction —
 * but surfaced, because the register has to be able to say "this month is not
 * finished being decided" rather than presenting a figure as settled.
 */
export function undecidedDays(timeline: MonthTimeline): number {
    return countDays(timeline.suspensions.filter(s => s.deduct === null))
}

/**
 * The day windows that actually get paid: employed, minus the suspensions ruled
 * deductible. Feed each one to splitMonth() as its window.
 *
 * Built by walking the days rather than by subtracting ranges. Range arithmetic
 * with overlaps is where off-by-one errors live, and a day array cannot produce
 * an overlapping or negative window no matter what the input looks like.
 */
export function payableWindows(timeline: MonthTimeline): DayRange[] {
    const length = daysInMonth(timeline.year, timeline.month)
    const payable = new Array<boolean>(length + 1).fill(false)

    for (const range of timeline.employed) {
        for (let day = range.fromDay; day <= range.toDay; day++) payable[day] = true
    }
    for (const suspension of timeline.suspensions) {
        if (suspension.deduct !== true) continue
        for (let day = suspension.fromDay; day <= suspension.toDay; day++) payable[day] = false
    }

    const windows: DayRange[] = []
    let start: number | null = null
    for (let day = 1; day <= length; day++) {
        if (payable[day] && start === null) start = day
        if (!payable[day] && start !== null) {
            windows.push({ fromDay: start, toDay: day - 1 })
            start = null
        }
    }
    if (start !== null) windows.push({ fromDay: start, toDay: length })
    return windows
}

export type SettlementDirection = "COMPANY_OWES" | "PERSON_OWES" | "SETTLED"

export interface SettlementPreview {
    year: number
    /** 1-12. */
    month: number
    /** The last day they are employed — the day before the end takes effect. */
    lastWorkingDay: number
    daysWorked: number
    /** What the final month's worked days are worth. */
    earnedMinor: Minor
    /** What has already gone out for that month. */
    paidMinor: Minor
    /** Positive: the company owes. Negative: the person owes. */
    netMinor: Minor
    direction: SettlementDirection
}

/**
 * What ending a contract on a given date would settle at.
 *
 * The sign is the whole point, and it turns on one thing: whether the month's
 * salary had already gone out before the last working day. End a contract on
 * the 25th of a month paid on the 28th and the company owes twenty-five days.
 * End it on the 25th of a month paid on the 20th and the person owes back the
 * five days they were paid for and did not work. Same date, same salary,
 * opposite direction — which is exactly why this is previewed against the
 * chosen date before anybody commits to it, rather than discovered afterwards.
 *
 * `paidMinor` is supplied rather than looked up: what has been paid lives in
 * the payroll tables, and this stays a calculation over its arguments so the
 * cases above can be tested without one.
 */
export function previewSettlement(input: {
    events: EmploymentEventRow[]
    /** The month's salary rates, as ratesForMonth() returns them. */
    rates: RateChange[]
    /** The first instant they are no longer employed. */
    endsAt: Date
    /** Already paid for the final month. Zero when payday has not come round. */
    paidMinor?: Minor
    timeZone?: string
}): SettlementPreview {
    const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE
    const { year, month } = calendarParts(input.endsAt, timeZone)

    // The proposed end, applied on top of the real history. Dated to win any
    // tie on its own instant: the preview is answering "what if we end it
    // here", so nothing recorded earlier for the same instant should undo it.
    const events: EmploymentEventRow[] = [
        ...input.events,
        { type: "CONTRACT_ENDED", effectiveFrom: input.endsAt, createdAt: new Date(8.64e15) },
    ]

    const timeline = timelineForMonth(events, year, month, timeZone)
    const windows = payableWindows(timeline)

    let earnedMinor = 0
    let daysWorked = 0
    for (const window of windows) {
        for (const segment of splitMonth(year, month, input.rates, window)) {
            earnedMinor += valueSegment(segment)
        }
        daysWorked += window.toDay - window.fromDay + 1
    }

    const paidMinor = input.paidMinor ?? 0
    const netMinor = earnedMinor - paidMinor

    return {
        year,
        month,
        lastWorkingDay: calendarParts(new Date(input.endsAt.getTime() - 1), timeZone).day,
        daysWorked,
        earnedMinor,
        paidMinor,
        netMinor,
        direction: netMinor > 0 ? "COMPANY_OWES" : netMinor < 0 ? "PERSON_OWES" : "SETTLED",
    }
}

/**
 * Which employment event a change of User.status amounts to, if any.
 *
 * The existing screens change status directly — a suspend toggle, a status
 * dropdown — and those are the paths a real suspension actually comes in on.
 * If they do not also write an event, the timeline quietly disagrees with the
 * status field, which is the one failure this whole phase exists to prevent.
 * So the mapping lives here, next to the events, rather than being spelled out
 * again at each call site.
 *
 * Returns null for the transitions that are not about employment. ACTIVE,
 * OFFLINE and INACTIVE are presence — whether somebody is at their desk — and
 * a timeline that recorded them would be a session log, not an employment
 * history. DELETED is an administrative removal and deliberately has no event
 * either: it is not the end of a contract, and giving it one would make the two
 * indistinguishable in the register.
 */
export function eventForStatusChange(
    previous: string | null | undefined,
    next: string,
): EmploymentEventType | null {
    if (previous === next) return null

    const PRESENT = ["ACTIVE", "OFFLINE", "INACTIVE"]

    if (next === "SUSPENDED") return "SUSPENDED"
    if (next === "ARCHIVED") return "CONTRACT_ENDED"
    if (previous === "SUSPENDED" && PRESENT.includes(next)) return "UNSUSPENDED"
    if (previous === "ARCHIVED" && PRESENT.includes(next)) return "REINSTATED"
    return null
}

/**
 * Turning a last working day into the instant the contract ends.
 *
 * An admin picks the last day somebody works, because that is the thing they
 * know. The timeline stores the first instant they are no longer employed. The
 * conversion is one day, and doing it in one place is the difference between a
 * settlement that pays the leaving day and one that does not.
 */
export function endOfContractInstant(
    lastWorkingDay: string,
    timeZone: string = DEFAULT_TIME_ZONE,
): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastWorkingDay)) {
        throw new Error(`Not a date: ${lastWorkingDay}`)
    }
    // Midday, so the instant is safely on the intended calendar day in any
    // zone, then a day on and snapped to that day's start — rather than adding
    // 24 hours to a midnight, which lands on the same day across a daylight
    // saving change.
    const midday = new Date(`${lastWorkingDay}T12:00:00.000Z`)
    if (Number.isNaN(midday.getTime())) throw new Error(`Not a date: ${lastWorkingDay}`)
    return startOfDayIn(new Date(midday.getTime() + 24 * 60 * 60 * 1000), timeZone)
}

/** The three statuses the employment timeline has an opinion about. */
export type ImpliedStatus = "ACTIVE" | "SUSPENDED" | "ARCHIVED"

/**
 * What the timeline says somebody's status should be at an instant.
 *
 * Null when it has no opinion: nobody was ever hired, or the instant is before
 * they were. Silence and "active" are different answers, and a job that acted
 * on the first as though it were the second would set a status from an empty
 * history.
 */
export function impliedStatusAt(events: EmploymentEventRow[], at: Date): ImpliedStatus | null {
    const spans = employmentSpans(events)
    if (spans.length === 0) return null
    if (at.getTime() < spans[0].from.getTime()) return null

    const within = (span: Span) =>
        span.from.getTime() <= at.getTime()
        && (span.to === null || at.getTime() < span.to.getTime())

    if (!spans.some(within)) return "ARCHIVED"
    return suspensionSpans(events).some(within) ? "SUSPENDED" : "ACTIVE"
}

/**
 * The status to write, if any, when the timeline and User.status disagree.
 *
 * The timeline owns SUSPENDED and ARCHIVED and nothing else. ACTIVE, OFFLINE
 * and INACTIVE are presence — whether somebody's browser is talking to us — and
 * a reconciliation that wrote ACTIVE over OFFLINE would show every employee as
 * online once a day, at whatever hour the job happens to run.
 *
 * So an implied ACTIVE only ever lifts a state the timeline itself put them in.
 */
export function reconcileStatus(current: string, implied: ImpliedStatus | null): ImpliedStatus | null {
    if (implied === null || implied === current) return null
    if (implied === "ARCHIVED" || implied === "SUSPENDED") return implied
    return current === "SUSPENDED" || current === "ARCHIVED" ? "ACTIVE" : null
}
