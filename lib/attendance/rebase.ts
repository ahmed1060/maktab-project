/**
 * A form that edits what is in force from a date, a policy or a schedule's
 * hours, starts from the version in force on that date. When the date moves,
 * so does the version (review on #64): from what is in force on the date first
 * suggested, an earlier date copied a later version's settings back, and a
 * later one past another change saved over that change.
 *
 * Untouched, the form moves to the version in force on the new date. Edited,
 * it keeps the edits, which were made on the version it opened with, and says
 * the new date has another: `stale`, offered to start again from.
 */
export type Based<T> = { base: T; current: T; stale: T | null }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function rebaseOnDate<T>(state: Based<T>, inForce: T | null): Based<T> {
    if (inForce === null || same(inForce, state.base)) return { ...state, stale: null }
    if (same(state.current, state.base)) return { base: inForce, current: structuredClone(inForce), stale: null }
    return { ...state, stale: inForce }
}

/** Starts again from the version in force on the date, dropping the edits. */
export function startFromStale<T>(state: Based<T>): Based<T> {
    return state.stale === null ? state : { base: state.stale, current: structuredClone(state.stale), stale: null }
}
