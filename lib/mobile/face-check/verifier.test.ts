import { describe, it, expect, vi } from "vitest"
import type { Camera } from "./camera"
import type { Store } from "./vault"
import type { Captured } from "./capture"

/**
 * The verifier's handling of the camera (review on #28): Cancel means nothing
 * comes back to be sent, whenever it comes; and what it makes of a capture.
 * The capture and the models are stood in for.
 */

const captured = vi.hoisted(() => ({ next: null as null | (() => Promise<unknown>) }))
vi.mock("./engine", () => ({ loadEngine: async (onProgress?: (n: number) => void) => { onProgress?.(1); return {} } }))
vi.mock("./capture", () => ({ capture: () => captured.next!() }))

const { faceCheckVerifier, FACE_CHECK_MODEL } = await import("./verifier")

function camera(): Camera & { cancel(): void; closed: boolean; loads: (number | null)[] } {
    let reject: (e: Error) => void = () => {}
    const cancelled = new Promise<never>((_, r) => { reject = r })
    cancelled.catch(() => {})
    const cam = {
        video: {} as HTMLVideoElement, closed: false, cancelled, loads: [] as (number | null)[],
        say: () => {}, close: () => { cam.closed = true }, loading: (s: number | null) => { cam.loads.push(s) },
        cancel: () => reject(Object.assign(new Error("FACE_CANCELLED"), { code: "FACE_CANCELLED" })),
    }
    return cam
}

/** A store whose writes take a while, so Cancel can land during one. */
function slowStore(): Store & { writes: number } {
    const map = new Map<string, unknown>()
    const store = {
        writes: 0,
        get: async (k: string) => map.get(k),
        set: async (k: string, v: unknown) => { await new Promise(r => setTimeout(r, 50)); store.writes++; map.set(k, v) },
        delete: async (k: string) => { map.delete(k) },
    }
    return store
}

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
const me = [1, 0, 0]
const someoneElse = [0, 1, 0]
const live = (over: Partial<Captured> = {}): Captured => ({ live: true, templates: [me, me], real: 0.9, photo: "cGhvdG8=", frame: "ZnJhbWU=", ...over })

/** A verifier with `me` approved on this phone. */
async function enrolled() {
    const store = slowStore()
    const verifier = faceCheckVerifier(async () => camera(), store)
    captured.next = async () => live()
    await verifier.enrol(key)
    await verifier.promote()
    return store
}

describe("the face check verifier and the camera", () => {
    it("returns no photo when the person cancels while the templates are being stored", async () => {
        const cam = camera()
        captured.next = async () => live()
        const verifier = faceCheckVerifier(async () => cam, slowStore())
        const enrolling = verifier.enrol(key)
        await new Promise(r => setTimeout(r, 20))
        cam.cancel()
        await expect(enrolling).rejects.toMatchObject({ message: "FACE_CANCELLED" })
        expect(cam.closed).toBe(true)
    })

    it("returns the photo when nobody cancels, closes the camera, and shows the models loading", async () => {
        const cam = camera()
        captured.next = async () => live()
        const verifier = faceCheckVerifier(async () => cam, slowStore())
        expect(await verifier.enrol(key)).toEqual({ photo: "cGhvdG8=" })
        expect(cam.closed).toBe(true)
        expect(cam.loads).toEqual([1, null])
    })

    it("says which model made the templates, so the server can tell old ones apart", async () => {
        const verifier = faceCheckVerifier(async () => camera(), slowStore())
        expect((await verifier.info()).modelVersion).toBe(FACE_CHECK_MODEL)
        expect(FACE_CHECK_MODEL).toMatch(/^prototype-/)
    })
})

describe("the face check verifier's verdict", () => {
    it("verifies the approved face, live", async () => {
        const verifier = faceCheckVerifier(async () => camera(), await enrolled())
        captured.next = async () => live()
        expect(await verifier.verify(key)).toMatchObject({ verified: true, attempts: 1, liveness: 0.9, frame: null })
    })

    it("doesn't verify someone else, after three tries, and gives the last frame", async () => {
        const verifier = faceCheckVerifier(async () => camera(), await enrolled())
        captured.next = async () => live({ templates: [someoneElse, someoneElse] })
        expect(await verifier.verify(key)).toMatchObject({ verified: false, attempts: 3, score: 0, frame: "ZnJhbWU=" })
    })

    it("sends the right face for review when the anti-spoofing doubts it's live, without asking again", async () => {
        const verifier = faceCheckVerifier(async () => camera(), await enrolled())
        let tries = 0
        captured.next = async () => { tries++; return live({ real: 0.2 }) }
        expect(await verifier.verify(key)).toMatchObject({ verified: false, score: 1, liveness: 0.2, attempts: 1, frame: "ZnJhbWU=" })
        expect(tries).toBe(1)
    })

    it("refuses to enrol without passing the challenge", async () => {
        const verifier = faceCheckVerifier(async () => camera(), slowStore())
        captured.next = async () => live({ live: false, templates: [] })
        await expect(verifier.enrol(key)).rejects.toMatchObject({ code: "LIVENESS_FAILED" })
    })
})
