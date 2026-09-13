/**
 * Centralized utility for handling system time in Egypt's timezone (Africa/Cairo).
 * This ensures consistency and prevents manipulation by local device clock changes.
 */

export const EGYPT_TIMEZONE = 'Africa/Cairo';

/**
 * Returns the current Date object adjusted to Egypt's timezone.
 */
export function getEgyptNow(): Date {
    const now = new Date();
    // Convert current UTC time to Egypt time string and then back to Date
    const egyptStr = now.toLocaleString('en-US', { timeZone: EGYPT_TIMEZONE });
    return new Date(egyptStr);
}

/**
 * Returns today's date in Egypt as a string (YYYY-MM-DD).
 */
export function getEgyptTodayStr(): string {
    const now = getEgyptNow();
    return formatToYYYYMMDD(now);
}

/**
 * Returns tomorrow's date in Egypt as a string (YYYY-MM-DD).
 */
export function getEgyptTomorrowStr(): string {
    const tomorrow = getEgyptNow();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatToYYYYMMDD(tomorrow);
}

/**
 * Returns yesterday's date in Egypt as a string (YYYY-MM-DD).
 */
export function getEgyptYesterdayStr(): string {
    const yesterday = getEgyptNow();
    yesterday.setDate(yesterday.getDate() - 1);
    return formatToYYYYMMDD(yesterday);
}

/**
 * Formats a Date object to YYYY-MM-DD using local time (which is already Egypt time here).
 */
function formatToYYYYMMDD(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Checks if a given date string is Friday in Egypt.
 */
export function isFridayInEgypt(dateStr: string): boolean {
    const date = new Date(dateStr);
    // Since dateStr is likely YYYY-MM-DD, new Date(dateStr) depends on local timezone.
    // However, if we mean "is this specific calendar day a Friday", getDay() is usually sufficient
    // as long as we aren't crossing midnight boundaries.
    return date.getDay() === 5;
}

/**
 * The last instant of a date's calendar day in Egypt, as a real UTC instant.
 *
 * Subscription boundaries resolve at end of day locally, never at 00:00 UTC. A
 * subscription "ending 8 October" should work for all of 8 October in Cairo; a
 * raw timestamp comparison would cut it off at whatever time of day the payment
 * happened to be confirmed, and a UTC midnight would cut it off two or three
 * hours before the customer's day even ended.
 *
 * Computed from the offset actually in effect on that date rather than a fixed
 * +02:00 — Egypt reintroduced daylight saving in 2023, so the offset is +02:00
 * in winter and +03:00 in summer, and hardcoding either is wrong for half the
 * year.
 */
export function endOfDayInEgypt(date: Date): Date {
    const offsetMs = egyptOffsetMs(date);

    // Shift into Egypt's wall clock, take that calendar day, then shift back.
    const local = new Date(date.getTime() + offsetMs);
    const endOfLocalDay = Date.UTC(
        local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(),
        23, 59, 59, 999
    );

    // Re-derive the offset at the boundary itself: a day that contains a DST
    // transition ends at a different offset than it began.
    const provisional = new Date(endOfLocalDay - offsetMs);
    return new Date(endOfLocalDay - egyptOffsetMs(provisional));
}

/**
 * Egypt's UTC offset in milliseconds at a given instant, read from the runtime's
 * own timezone database rather than assumed.
 */
function egyptOffsetMs(at: Date): number {
    // Milliseconds are stripped from both sides before differencing.
    // toLocaleString has no millisecond field, so comparing its output against
    // an instant that carries one bakes that remainder into the offset — which
    // showed up as an end-of-day landing on 22:00:00.998Z instead of
    // 21:59:59.999Z. The offset is only ever whole minutes anyway.
    const whole = new Date(Math.floor(at.getTime() / 1000) * 1000);
    // 'sv' gives an ISO-shaped "YYYY-MM-DD HH:MM:SS", which parses predictably.
    const asEgypt = new Date(whole.toLocaleString('sv', { timeZone: EGYPT_TIMEZONE }) + 'Z');
    return asEgypt.getTime() - whole.getTime();
}
