import { describe, it, expect, vi } from "vitest"
import type { Reading } from "./liveness"
import type { Camera } from "./camera"
import type { Engine } from "./engine"

/**
 * One whole capture with the camera and the models stood in for: a scripted
 * run of what the face does, as MediaPipe reads it, and who the recognition
 * says it is on the two frontal looks.
 */

vi.mock("./engine", () => ({ grab: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) }))
/** Each snapshot numbered, so which frame was kept can be told. */
const shots = vi.hoisted(() => ({ n: 0 }))
vi.mock("./camera", () => ({ snapshot: () => `shot${++shots.n}` }))

const { capture } = await import("./capture")

const facing = (eyes = 0.05): Reading => ({ eyes, turn: 0.5 })
const turned = (eyes = 0.05): Reading => ({ eyes, turn: 0.7 })

/** 512 numbers of length 1, pointing mostly along `axis`: the same axis is the same person. */
function person(axis: number, wobble = 0): number[] {
    const v = Array.from({ length: 512 }, (_, i) => (i === axis ? 1 : i === axis + 1 ? wobble : 0))
    const n = Math.hypot(...v)
    return v.map(x => x / n)
}

/** An engine that reads the scripted looks in turn, and identifies each frontal look as the next of `who`. */
function engine(looks: (Reading | null)[], who: { embedding: number[] | null; faces?: number; live?: number }[]): Engine & { identified: number } {
    let i = 0, j = 0
    const e = {
        identified: 0,
        read: () => {
            const reading = looks[Math.min(i++, looks.length - 1)]
            return { faces: reading ? 1 : 0, reading }
        },
        identify: async () => {
            e.identified++
            const w = who[Math.min(j++, who.length - 1)]
            return { faces: w.faces ?? (w.embedding ? 1 : 0), embedding: w.embedding, live: w.embedding ? w.live ?? 0.9 : null }
        },
    }
    return e
}

function camera() {
    const cues: string[] = []
    const shown: unknown[] = []
    const said: string[] = []
    const cam: Camera & { cues: string[]; shown: unknown[]; said: string[] } = {
        video: {} as HTMLVideoElement, cancelled: new Promise<never>(() => {}),
        say: p => { said.push(p) }, close: () => {}, show: p => { shown.push(p) }, cue: c => { cues.push(c) }, cues, shown, said,
    }
    return cam
}

/** Five looks at the camera, the challenge BLINK then TURN (random() = 0.9), and the last look. */
const passing = [
    ...Array(5).fill(facing()),
    facing(), facing(0.8), facing(),
    facing(), turned(), facing(),
    facing(),
]

describe("a whole capture", () => {
    it("passes a blink and a turn, matching the face before and after, and keeps the first look's photo", async () => {
        const e = engine(passing, [{ embedding: person(3) }, { embedding: person(3, 0.2), live: 0.7 }])
        shots.n = 0
        const c = await capture(e, camera(), () => 0.9)
        expect(c.live).toBe(true)
        expect(c.templates).toHaveLength(2)
        expect(c.photo).toBe("shot1")
        // The anti-spoofing's lower score of the two looks.
        expect(c.real).toBeCloseTo(0.7)
        // Recognition runs on the two frontal looks only, not on every look of the challenge.
        expect(e.identified).toBe(2)
    })

    it("fails when the face after the challenge isn't the one before it", async () => {
        const c = await capture(engine(passing, [{ embedding: person(3) }, { embedding: person(100) }]), camera(), () => 0.9)
        expect(c.live).toBe(false)
        expect(c.templates).toEqual([])
    })

    it("keeps the frame where a second face was found, for the review (review on #47)", async () => {
        shots.n = 0
        const c = await capture(engine(passing, [{ embedding: person(3) }, { embedding: null, faces: 2 }]), camera(), () => 0.9)
        expect(c.live).toBe(false)
        expect(c.photo).toBe("shot1")
        expect(c.frame).toBe("shot2")
    })

    it("counts a blink as MediaPipe reads one: open about 0.05, shut 0.6 or more", async () => {
        // Found on a phone with the first prototype: the blink was never seen. These are MediaPipe's eyeBlink scores.
        const looks = [...Array(5).fill(facing(0.04)), facing(0.04), facing(0.62), facing(0.07), facing(), turned(), facing(), facing()]
        const c = await capture(engine(looks, [{ embedding: person(3) }]), camera(), () => 0.9)
        expect(c.live).toBe(true)
    })

    it("tells the person each step half and wholly done", async () => {
        const cam = camera()
        await capture(engine(passing, [{ embedding: person(3) }]), cam, () => 0.9)
        expect(cam.cues).toEqual(["HALF", "STEP", "HALF", "STEP"])
    })

    it("waits for exactly one face before taking the first look", async () => {
        const cam = camera()
        // The look turned away by the second face doesn't count towards the five.
        const e = engine([facing(), ...passing], [{ embedding: null, faces: 2 }, { embedding: person(3) }])
        const c = await capture(e, cam, () => 0.9)
        expect(cam.said).toContain("ONE_FACE")
        expect(c.live).toBe(true)
    })

    it("starts each attempt with no progress left from the last one (review on #30)", async () => {
        let cancel: (e: Error) => void = () => {}
        const cancelled = new Promise<never>((_, reject) => { cancel = reject })
        cancelled.catch(() => {})
        const cam = { ...camera(), cancelled }
        cam.shown.push({ steps: [{ challenge: "TURN", done: true, current: false }] }) // the last attempt's
        const attempt = capture(engine([null], []), cam, () => 0.1)
        await new Promise(r => setTimeout(r, 0))
        expect(cam.shown[1]).toBeNull()
        cancel(new Error("FACE_CANCELLED"))
        await expect(attempt).rejects.toThrow("FACE_CANCELLED")
    })
})
