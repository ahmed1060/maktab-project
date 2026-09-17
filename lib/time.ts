/**
 * One clock rule, in two halves.
 *
 *   Instants are UTC.          createdAt, expiresAt, lastActivity, emailedAt —
 *                              every stored DateTime is a point in time, and
 *                              storing a wall clock instead loses information
 *                              and breaks comparison and sorting.
 *
 *   Calendar decisions are     Which month does this belong to. What is today.
 *   local to the company.      When does the day end. These are questions about
 *                              a human calendar, and the human is in Cairo.
 *
 * The second half is why "everything in UTC" was the wrong instruction. Cairo
 * runs two or three hours ahead, so it enters a new month first: a task penalty
 * at 00:30 Cairo on 1 October is October's, and UTC still reads 30 September.
 * Choosing UTC for month attribution causes that error rather than preventing
 * it — and the error is a salary adjustment filed against the wrong month.
 *
 * The zone is a parameter, not a constant, because Company gains a timezone
 * column in P8. Until then every caller takes the default, and the literal
 * lives here and nowhere else.
 */

export const DEFAULT_TIME_ZONE = 'Africa/Cairo';

/** Kept under its old name: three callers still import it. */
export const EGYPT_TIMEZONE = DEFAULT_TIME_ZONE;

export interface CalendarParts {
    year: number;
    /** 1-12, not 0-11. The off-by-one in Date's month is a bug generator. */
    month: number;
    day: number;
    hour: number;
    minute: number;
    /** 0 = Sunday, matching Date.getDay(). */
    weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The calendar fields a person in `timeZone` would read off a wall clock at
 * this instant.
 *
 * Parts, never a Date. The helper this replaces — getEgyptNow — returned
 * `new Date(now.toLocaleString('en-US', { timeZone }))`, which is a Date whose
 * *instant* is two or three hours wrong: a lie shaped like a Date, safe only if
 * you pull a field off it and throw it away immediately. It also parsed that
 * string back in the server's own zone, so on any server not at UTC it was
 * wrong twice over, and setDate() arithmetic on the result inherited the lie.
 *
 * formatToParts asks the runtime's timezone database directly, so there is no
 * string round-trip to get wrong and daylight saving is handled for the instant
 * in question — Egypt reintroduced it in 2023, so the offset is +02:00 in
 * winter and +03:00 in summer.
 */
export function calendarParts(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): CalendarParts {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false,
    }).formatToParts(instant);

    const find = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find(p => p.type === type)?.value ?? '';

    return {
        year: Number(find('year')),
        month: Number(find('month')),
        day: Number(find('day')),
        // hour12:false yields 24 for midnight in some runtimes rather than 0.
        hour: Number(find('hour')) % 24,
        minute: Number(find('minute')),
        weekday: Math.max(0, WEEKDAYS.indexOf(find('weekday'))),
    };
}

/**
 * Which month a record belongs to. The single most important thing in this
 * file: every salary record, adjustment, penalty and deduction is keyed on
 * this pair, and they disagreeing is how an adjustment lands on a month that
 * has no record, or a second record is created for a month that already had
 * one.
 */
export function calendarMonth(
    instant: Date,
    timeZone: string = DEFAULT_TIME_ZONE,
): { month: number; year: number } {
    const { month, year } = calendarParts(instant, timeZone);
    return { month, year };
}

/** The calendar year alone, for anything keyed on a year rather than a month. */
export function calendarYear(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): number {
    return calendarParts(instant, timeZone).year;
}

/** Today's date as YYYY-MM-DD, as a person in that zone would write it. */
export function calendarDateStr(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
    const { year, month, day } = calendarParts(instant, timeZone);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The first instant of a date's calendar month in that zone, as a real UTC instant. */
export function startOfMonthIn(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): Date {
    const { year, month } = calendarParts(instant, timeZone);
    // Guessed in UTC, then corrected by the offset actually in effect there.
    const guess = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
    return new Date(guess - offsetMsIn(new Date(guess), timeZone));
}

/** Midnight at the start of a date's calendar day in that zone, as a UTC instant. */
export function startOfDayIn(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): Date {
    const { year, month, day } = calendarParts(instant, timeZone);
    const guess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
    return new Date(guess - offsetMsIn(new Date(guess), timeZone));
}

/**
 * The last instant of a date's calendar day, as a real UTC instant.
 *
 * Subscription boundaries resolve at end of day locally, never at 00:00 UTC. A
 * subscription "ending 8 October" should work for all of 8 October in Cairo; a
 * raw timestamp comparison would cut it off at whatever time of day the payment
 * happened to be confirmed, and a UTC midnight would cut it off two or three
 * hours before the customer's day even ended.
 */
export function endOfDayIn(date: Date, timeZone: string = DEFAULT_TIME_ZONE): Date {
    const offsetMs = offsetMsIn(date, timeZone);

    // Shift into the zone's wall clock, take that calendar day, then shift back.
    const local = new Date(date.getTime() + offsetMs);
    const endOfLocalDay = Date.UTC(
        local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(),
        23, 59, 59, 999
    );

    // Re-derive the offset at the boundary itself: a day that contains a DST
    // transition ends at a different offset than it began.
    const provisional = new Date(endOfLocalDay - offsetMs);
    return new Date(endOfLocalDay - offsetMsIn(provisional, timeZone));
}

/** Kept under its old name: lib/billing/state.ts and its tests import it. */
export const endOfDayInEgypt = (date: Date): Date => endOfDayIn(date);

/**
 * A zone's UTC offset in milliseconds at a given instant, read from the
 * runtime's own timezone database rather than assumed.
 */
export function offsetMsIn(at: Date, timeZone: string = DEFAULT_TIME_ZONE): number {
    // Milliseconds are stripped from both sides before differencing.
    // toLocaleString has no millisecond field, so comparing its output against
    // an instant that carries one bakes that remainder into the offset — which
    // showed up as an end-of-day landing on 22:00:00.998Z instead of
    // 21:59:59.999Z. The offset is only ever whole minutes anyway.
    const whole = new Date(Math.floor(at.getTime() / 1000) * 1000);
    // 'sv' gives an ISO-shaped "YYYY-MM-DD HH:MM:SS", which parses predictably.
    const asLocal = new Date(whole.toLocaleString('sv', { timeZone }) + 'Z');
    return asLocal.getTime() - whole.getTime();
}
