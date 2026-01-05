/**
 * Centralized utility for handling system time in Egypt's timezone (Africa/Cairo).
 * This ensures consistency and prevents manipulation by local device clock changes.
 */

const EGYPT_TIMEZONE = 'Africa/Cairo';

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
