import { describe, it, expect, vi } from "vitest"
import type { Reading } from "./liveness"
import type { Camera } from "./camera"
import type { Engine } from "./engine"

/**
 * One whole capture with the camera and the models stood in for: a scripted
 * face, as MediaPipe reads it, and who the recognition says it is on each look.
 * Passive first: the face fitted in the oval, two looks, and a step only when
 * the check has doubts.
 */

vi.mock("./engine", () => ({ grab: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) }))
/** Each snapshot numbered, so which frame was kept can be told. */
const shots = vi.hoisted(() => ({ n: 0 }))
vi.mock("./camera", () => ({ snapshot: () => `shot${++shots.n}` }))

const { capture, doubtful, fitOf, SURE } = await import("./capture")

/** Facing the camera, the face in the oval. */
const facing = (eyes = 0.05): Reading => ({ eyes, turn: 0.5, box: { x: 0.3, y: 0.25, w: 0.4, h: 0.45 } })
const turned = (): Reading => ({ ...facing(), turn: 0.7 })

/** 512 numbers of length 1, pointing mostly along `axis`: the same axis is the same person. */
function person(axis: number, wobble = 0): number[] {
    const v = Array.from({ length: 512 }, (_, i) => (i === axis ? 1 : i === axis + 1 ? wobble : 0))
    const n = Math.hypot(...v)
    return v.map(x => x / n)
}

type Who = { embedding: number[] | null; faces?: number; live?: number }

/**
 * An engine that reads `before` until the looks are taken, then the step's
 * `after` looks in turn (the last one again and again); and identifies each
 * look as the next of `who` (the last one again and again).
 */
function engine(who: Who[], after: Reading[] = [facing()], before: () => Reading | null = () => facing()): Engine & { identified: number } {
    let i = 0, j = 0
    const e = {
        identified: 0,
        read: () => {
            const reading = e.identified < 2 ? before() : after[Math.min(i++, after.length - 1)]
            return { faces: reading ? 1 : 0, reading }
        },
        identify: async () => {
            e.identified++
            const w = who[Math.min(j++, who.length - 1)]
            return { faces: w.faces ?? (w.embedding ? 1 : 0), embedding: w.embedding, live: w.embedding ? w.live ?? 0.95 : null }
        },
    }
    return e
}

function camera() {
    const said: string[] = [], shown: unknown[] = [], fills: (number | null)[] = [], cues: string[] = []
    const cam: Camera & { said: string[]; shown: unknown[]; fills: (number | null)[]; cues: string[] } = {
        video: {} as HTMLVideoElement, cancelled: new Promise<never>(() => {}),
        say: p => { said.push(p) }, close: () => {}, show: p => { shown.push(p) }, fill: s => { fills.push(s) }, cue: c => { cues.push(c) },
        said, shown, fills, cues,
    }
    return cam
}

describe("a passive capture", () => {
    it("takes two looks on its own and is done, with no step, when it is sure", async () => {
        shots.n = 0
        const e = engine([{ embedding: person(3) }, { embedding: person(3, 0.1) }])
        const cam = camera()
        const c = await capture(e, cam)
        expect(c).toMatchObject({ live: true, challenged: false, photo: "shot1" })
        expect(c.templates).toHaveLength(2)
        expect(e.identified).toBe(2)
        // The ring filled to the end, and the person was told it's done.
        expect(cam.fills.at(-1)).toBe(1)
        expect(cam.said.at(-1)).toBe("DONE")
        expect(cam.said).not.toContain("BLINK")
        expect(cam.said).not.toContain("TURN_HEAD")
    })

    it("asks for one step when the anti-spoofing isn't sure, then a last look of the same face", async () => {
        const e = engine([{ embedding: person(3), live: 0.6 }], [facing(), facing(0.8), facing(), facing()])
        const cam = camera()
        const c = await capture(e, cam, { random: () => 0.9 })
        expect(c).toMatchObject({ live: true, challenged: true })
        expect(cam.said).toContain("EXTRA")
        expect(cam.said).toContain("BLINK")
        // One step, not two.
        expect(cam.said).not.toContain("TURN_HEAD")
        expect(c.templates).toHaveLength(3)
        expect(c.real).toBeCloseTo(0.6)
    })

    it("asks for the step when told to (a second attempt), however sure it is", async () => {
        const c = await capture(engine([{ embedding: person(3) }], [facing(), turned(), facing(), facing()]), camera(), { challenge: true, random: () => 0.1 })
        expect(c).toMatchObject({ live: true, challenged: true })
    })

    it("fails, without asking for a step, when the two looks are two different faces", async () => {
        const cam = camera()
        const c = await capture(engine([{ embedding: person(3) }, { embedding: person(100) }]), cam)
        expect(c).toMatchObject({ live: false, challenged: false, templates: [] })
        expect(cam.said).not.toContain("EXTRA")
    })

    it("fails when recognition sees a second face, keeping that frame for the review", async () => {
        shots.n = 0
        const c = await capture(engine([{ embedding: person(3) }, { embedding: null, faces: 2 }]), camera())
        expect(c.live).toBe(false)
        expect(c.frame).toBe("shot2")
    })

    it("takes a look again when recognition found no face in it", async () => {
        const e = engine([{ embedding: person(3) }, { embedding: null }, { embedding: person(3) }])
        expect((await capture(e, camera())).live).toBe(true)
        expect(e.identified).toBe(3)
    })

    it("guides the face into the oval before taking any look", async () => {
        const far = { ...facing(), box: { x: 0.42, y: 0.4, w: 0.15, h: 0.2 } }
        const near = { ...facing(), box: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 } }
        const aside = { ...facing(), box: { x: 0.65, y: 0.25, w: 0.3, h: 0.4 } }
        const script = [far, far, near, near, aside, aside]
        let k = 0
        const e = engine([{ embedding: person(3) }], [facing()], () => script[k++] ?? facing())
        const cam = camera()
        await capture(e, cam)
        expect(cam.said.slice(0, 6)).toEqual(["CLOSER", "CLOSER", "FARTHER", "FARTHER", "CENTER", "CENTER"])
        expect(e.identified).toBe(2)
    })

    it("starts each attempt with nothing filled or ticked from the last (review on #30)", async () => {
        let cancel: (e: Error) => void = () => {}
        const cancelled = new Promise<never>((_, reject) => { cancel = reject })
        cancelled.catch(() => {})
        const cam = { ...camera(), cancelled }
        const attempt = capture(engine([{ embedding: null }], [facing()], () => null), cam)
        await new Promise(r => setTimeout(r, 0))
        expect(cam.shown[0]).toBeNull()
        expect(cam.fills[0]).toBe(0)
        cancel(new Error("FACE_CANCELLED"))
        await expect(attempt).rejects.toThrow("FACE_CANCELLED")
    })
})

describe("the rules", () => {
    it("fits a face of a third to three quarters of the width, near the middle", () => {
        expect(fitOf({ x: 0.3, y: 0.25, w: 0.4, h: 0.45 })).toBeNull()
        expect(fitOf({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 })).toBe("CLOSER")
        expect(fitOf({ x: 0, y: 0, w: 0.9, h: 0.9 })).toBe("FARTHER")
        expect(fitOf({ x: 0.6, y: 0.3, w: 0.35, h: 0.4 })).toBe("CENTER")
        expect(fitOf(undefined)).toBeNull()
    })

    it("fits the face as it appears on the screen, which crops the camera's picture", () => {
        // A landscape picture on a tall phone: the middle third of its width shows.
        const view = { x: 1 / 3, y: 0, w: 1 / 3, h: 1 }
        const face = { x: 0.4, y: 0.3, w: 0.2, h: 0.35 }
        expect(fitOf(face)).toBe("CLOSER")
        expect(fitOf(face, view)).toBeNull()
    })

    it("has doubts below the sure levels, or on a second attempt", () => {
        const a = person(3), b = person(3, 0.1)
        expect(doubtful([0.95, 0.9], [a, b], false)).toBe(false)
        expect(doubtful([SURE.live - 0.01, 0.95], [a, b], false)).toBe(true)
        expect(doubtful([], [a, b], false)).toBe(true)
        expect(doubtful([0.95, 0.95], [a, person(3, 1.2)], false)).toBe(true)
        expect(doubtful([0.95, 0.95], [a, b], true)).toBe(true)
    })
})
