/**
 * Matching for the prototype: 128-number face descriptors from dlib's face
 * recognition network (public domain), compared by distance. Below 0.6 is
 * dlib's own "same person"; the prototype is stricter.
 */

export type Descriptor = readonly number[]

/** Same person below this. */
export const MATCH_DISTANCE = 0.5

/** Two descriptors from one capture must be closer than this: the same face throughout. */
export const SAME_CAPTURE_DISTANCE = 0.45

export function distance(a: Descriptor, b: Descriptor): number {
    if (a.length !== b.length || a.length === 0) return Infinity
    let sum = 0
    for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
    return Math.sqrt(sum)
}

/** The closest of the enrolled descriptors to this one. */
export function closest(enrolled: readonly Descriptor[], probe: Descriptor): number {
    return enrolled.reduce((best, d) => Math.min(best, distance(d, probe)), Infinity)
}

/** A 0..1 score for the server's record: 1 identical, 0 at twice the threshold or beyond. */
export function scoreOf(d: number): number {
    if (!Number.isFinite(d)) return 0
    return Math.max(0, Math.min(1, 1 - d / (2 * MATCH_DISTANCE)))
}

export function matches(enrolled: readonly Descriptor[], probe: Descriptor): { verified: boolean; score: number } {
    const d = closest(enrolled, probe)
    return { verified: d < MATCH_DISTANCE, score: scoreOf(d) }
}

/** Whether descriptors taken during one capture are all of the same face. */
export function oneFace(captured: readonly Descriptor[]): boolean {
    for (let i = 0; i < captured.length; i++)
        for (let j = i + 1; j < captured.length; j++)
            if (distance(captured[i], captured[j]) >= SAME_CAPTURE_DISTANCE) return false
    return captured.length > 0
}
