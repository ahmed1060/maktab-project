import { cosine } from "./models"
import type { Template } from "./vault"

/**
 * Matching: ArcFace's 512 numbers for two faces, compared by the cosine of
 * the angle between them, 1 for the same picture.
 *
 * MATCH_COSINE is from the photos in scripts/face-check-eval.mts: the same
 * person's lowest pair was 0.55 (different years, light and angle), two
 * different people's highest 0.23. 0.40 sits between with room on both
 * sides; InsightFace's own examples use 0.2 to 0.3 for "same person".
 */

/** Same person at or above this. */
export const MATCH_COSINE = 0.4

/**
 * The two looks of one capture must be at least this alike: the same face
 * throughout. A few seconds apart, the same person reads 0.8 or more.
 */
export const SAME_CAPTURE_COSINE = 0.5

/** The closest of the enrolled templates to this one. */
export function closest(enrolled: readonly Template[], probe: Template): number {
    return enrolled.reduce((best, t) => Math.max(best, cosine(t, probe)), -1)
}

/** A 0..1 score for the server's record: the cosine, with anything below 0 as 0. */
export function scoreOf(c: number): number {
    return Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0
}

export function matches(enrolled: readonly Template[], probe: Template): { verified: boolean; score: number } {
    const c = closest(enrolled, probe)
    return { verified: c >= MATCH_COSINE, score: scoreOf(c) }
}

/** Whether the templates taken during one capture are all of the same face. */
export function oneFace(captured: readonly Template[]): boolean {
    for (let i = 0; i < captured.length; i++)
        for (let j = i + 1; j < captured.length; j++)
            if (cosine(captured[i], captured[j]) < SAME_CAPTURE_COSINE) return false
    return captured.length > 0
}
