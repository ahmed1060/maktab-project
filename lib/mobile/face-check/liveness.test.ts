import { describe, it, expect } from "vitest"
import { LIMITS, baselineOf, challenges, closedAt, frontal, progressOf, startLiveness, step, type Challenge, type LivenessState, type Reading } from "./liveness"

/**
 * The liveness challenge on sequences of readings shaped like MediaPipe's:
 * eyeBlink scores near 0.05 open and 0.6 to 0.9 shut, sampled at a phone's
 * 10 to 20 looks a second.
 */

const facing = (eyes = 0.05): Reading => ({ eyes, turn: 0.5 })
const turned = (side: 1 | -1, eyes = 0.05): Reading => ({ eyes, turn: 0.5 + side * 0.2 })

/** Runs readings one look apart, `gap` ms each, and gives the end state and the prompts said. */
function run(order: Challenge[], readings: (Reading | null)[], opts: { baseline?: number; gap?: number; faces?: number } = {}) {
    let s: LivenessState = startLiveness(order, 0, opts.baseline)
    const said: string[] = []
    readings.forEach((reading, i) => {
        const r = step(s, { faces: reading ? opts.faces ?? 1 : 0, reading, at: (i + 1) * (opts.gap ?? 80) })
        s = r.state
        said.push(r.prompt)
    })
    return { s, said }
}

describe("the blink", () => {
    it("counts a quick blink caught in only two looks", () => {
        // Eyes shut for ~150 ms: at 80 ms a look, two readings land on it.
        const { s } = run(["BLINK"], [facing(), facing(), facing(0.62), facing(0.7), facing(0.08)])
        expect(s.done).toBe(true)
    })

    it("counts a slow, deliberate one", () => {
        const { s } = run(["BLINK"], [facing(), facing(0.2), facing(0.4), facing(0.75), facing(0.85), facing(0.85), facing(0.5), facing(0.2), facing(0.06)])
        expect(s.done).toBe(true)
    })

    it("doesn't count a squint", () => {
        const { s, said } = run(["BLINK"], [facing(), facing(0.3), facing(0.38), facing(0.3), facing(0.05)])
        expect(s.done).toBe(false)
        expect(said.at(-1)).toBe("BLINK")
    })

    it("asks for the eyes open again before it's done", () => {
        const { s, said } = run(["BLINK"], [facing(), facing(0.8), facing(0.4)])
        expect(s.done).toBe(false)
        expect(said.slice(1)).toEqual(["OPEN_EYES", "OPEN_EYES"])
    })

    it("judges eyes against the person's own: eyes that read 0.3 open need 0.6 to count as shut", () => {
        expect(closedAt(0.3)).toBeCloseTo(0.6)
        const own = { baseline: 0.3 }
        expect(run(["BLINK"], [facing(0.3), facing(0.5), facing(0.3)], own).s.done).toBe(false)
        expect(run(["BLINK"], [facing(0.3), facing(0.65), facing(0.32)], own).s.done).toBe(true)
    })

    it("sets the person's level from the middle look, so one squint doesn't", () => {
        expect(baselineOf([0.05, 0.06, 0.4, 0.04, 0.07])).toBeCloseTo(0.06)
        expect(baselineOf([])).toBe(LIMITS.openDefault)
    })
})

describe("the turn", () => {
    it("is a turn to either side and back to the camera", () => {
        expect(run(["TURN"], [facing(), turned(1), facing()]).s.done).toBe(true)
        expect(run(["TURN"], [facing(), turned(-1), turned(-1), facing()]).s.done).toBe(true)
    })

    it("isn't done turned away", () => {
        const { s, said } = run(["TURN"], [facing(), turned(1), turned(1)])
        expect(s.done).toBe(false)
        expect(said.at(-1)).toBe("LOOK_BACK")
    })

    it("only starts facing the camera with eyes open", () => {
        expect(frontal(facing())).toBe(true)
        expect(frontal(facing(0.7))).toBe(false)
        expect(frontal(turned(1))).toBe(false)
    })
})

describe("the challenge", () => {
    it("goes through both steps in the order given", () => {
        const { s, said } = run(["TURN", "BLINK"], [facing(), turned(1), facing(), facing(), facing(0.8), facing()])
        expect(s.done).toBe(true)
        expect(s.completed).toEqual(["TURN", "BLINK"])
        expect(said).toContain("TURN_HEAD")
    })

    it("picks either order", () => {
        expect(challenges(() => 0.2)).toEqual(["TURN", "BLINK"])
        expect(challenges(() => 0.8)).toEqual(["BLINK", "TURN"])
    })

    it("fails when a second face appears", () => {
        expect(run(["BLINK"], [facing(), facing()], { faces: 2 }).s.failed).toBe("FACES")
    })

    it("tries a slow step again, then gives up", () => {
        // A look a second, never blinking: three tries of 8 s, then out.
        const looks = Array.from({ length: 30 }, () => facing())
        const { s } = run(["BLINK"], looks, { gap: 1000 })
        expect(s.failed).toBe("TIMEOUT")
    })

    it("doesn't count time with no face against the step", () => {
        // Turned out of view for 6 s, then back: still the first try.
        const looks: (Reading | null)[] = [facing(), turned(1), ...Array.from({ length: 6 }, () => null), facing()]
        const { s } = run(["TURN"], looks, { gap: 1000 })
        expect(s.done).toBe(true)
        expect(s.tries).toBe(1)
    })

    it("shows how closed the eyes are against what's needed", () => {
        const s = startLiveness(["BLINK"], 0, 0.05)
        const p = progressOf(s, { faces: 1, reading: facing(0.45), at: 0 }, ["BLINK"])
        expect(p.eyes).toBeCloseTo(1)
        expect(progressOf(s, { faces: 0, reading: null, at: 0 }, ["BLINK"]).eyes).toBeNull()
    })
})
