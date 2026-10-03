import { describe, it, expect, vi } from "vitest"
import type { Landmarks } from "./liveness"
import type { Camera } from "./camera"

/**
 * One whole capture with the camera and the models stood in for: a scripted
 * run of what the face does. Found on the first try on a phone: a person
 * whose open eyes read below the fixed 0.25 got through the challenge and
 * then failed the last look at the camera, and the check started again.
 */

/** 68 landmarks facing the camera, nose `turned` from the middle, eyes `open` (EAR). */
function face(turned = 0, open = 0.3): Landmarks {
    const pts = Array.from({ length: 68 }, () => ({ x: 0, y: 0 }))
    const eye = (start: number, x0: number) => {
        const w = 30, h = open * w
        const e = [{ x: x0, y: 0 }, { x: x0 + 10, y: -h / 2 }, { x: x0 + 20, y: -h / 2 }, { x: x0 + w, y: 0 }, { x: x0 + 20, y: h / 2 }, { x: x0 + 10, y: h / 2 }]
        e.forEach((p, i) => { pts[start + i] = p })
    }
    eye(36, 0)
    eye(42, 70)
    pts[45] = { x: 100, y: 0 }
    pts[30] = { x: 50 + turned * 100, y: 40 }
    return pts
}

const script = vi.hoisted(() => ({ frames: [] as (() => Landmarks)[], i: 0 }))
vi.mock("./engine", () => ({
    look: async (_api: unknown, _video: unknown, withDescriptor: boolean) => {
        const next = script.frames[Math.min(script.i++, script.frames.length - 1)]
        return { faces: 1, landmarks: next(), descriptor: withDescriptor ? Array(128).fill(0.1) : null }
    },
}))
vi.mock("./camera", () => ({ snapshot: () => "ZnJhbWU=" }))

const { capture } = await import("./capture")

function camera() {
    const cues: string[] = []
    const cam: Camera & { cues: string[] } = {
        video: {} as HTMLVideoElement, cancelled: new Promise<never>(() => {}),
        say: () => {}, close: () => {}, show: () => {}, cue: c => { cues.push(c) }, cues,
    }
    return cam
}

describe("a whole capture", () => {
    it("passes someone whose eyes are narrower than the old fixed limit, to the end", async () => {
        const narrow = 0.2 // below the old 0.25 for "open"
        script.i = 0
        script.frames = [
            // Looking straight at the camera: photo and eye level.
            ...Array(5).fill(() => face(0, narrow)),
            // The challenge, BLINK first (random() = 0.9): facing, eyes shut, open; then facing, turn, back.
            () => face(0, narrow), () => face(0, 0.12), () => face(0, narrow),
            () => face(0, narrow), () => face(0.2, narrow), () => face(0, narrow),
            // The last look at the camera.
            () => face(0, narrow),
        ]
        const c = await capture({} as never, camera(), () => 0.9)
        expect(c.live).toBe(true)
        expect(c.descriptors).toHaveLength(2)
        expect(c.photo).toBe("ZnJhbWU=")
    })

    it("tells the person each step half and wholly done", async () => {
        script.i = 0
        script.frames = [
            ...Array(5).fill(() => face(0)),
            () => face(0), () => face(0.2), () => face(0),
            () => face(0), () => face(0, 0.1), () => face(0),
            () => face(0),
        ]
        const cam = camera()
        await capture({} as never, cam, () => 0.1)
        expect(cam.cues).toEqual(["HALF", "STEP", "HALF", "STEP"])
    })
})
