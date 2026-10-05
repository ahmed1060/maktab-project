import { describe, it, expect } from "vitest"
import { closest, matches, oneFace, scoreOf, MATCH_COSINE } from "./match"
import { cosine } from "./models"

const unit = (v: number[]) => { const n = Math.hypot(...v); return v.map(x => x / n) }
/** A face, and the same face at a given cosine from it. */
const a = unit([1, 0, 0, 0])
const at = (c: number) => unit([c, Math.sqrt(1 - c * c), 0, 0])

describe("matching", () => {
    it("matches at or above the threshold, not below", () => {
        expect(cosine(a, at(0.45))).toBeCloseTo(0.45)
        expect(matches([a], at(MATCH_COSINE + 0.01)).verified).toBe(true)
        expect(matches([a], at(MATCH_COSINE - 0.01)).verified).toBe(false)
        // Against the closest of several templates.
        expect(matches([unit([0, 0, 1, 0]), a], at(0.7))).toMatchObject({ verified: true })
        expect(closest([], a)).toBe(-1)
    })

    it("keeps the score between 0 and 1", () => {
        expect(scoreOf(1)).toBe(1)
        expect(scoreOf(-0.3)).toBe(0)
        expect(scoreOf(NaN)).toBe(0)
    })

    it("needs every look in one capture to be the same face", () => {
        expect(oneFace([a, at(0.8)])).toBe(true)
        expect(oneFace([a, at(0.3)])).toBe(false)
        expect(oneFace([])).toBe(false)
    })
})
