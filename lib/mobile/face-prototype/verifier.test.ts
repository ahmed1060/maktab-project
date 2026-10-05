import { describe, it, expect, vi } from "vitest"
import type { Camera } from "./camera"
import type { Store } from "./vault"

/**
 * The prototype verifier's handling of the camera (review on #28): Cancel
 * means nothing comes back to be sent, whenever it comes. The capture and
 * the models are stood in for; what matters is the order of events.
 */

const captured = vi.hoisted(() => ({ next: null as null | (() => Promise<unknown>) }))
vi.mock("./engine", () => ({ loadFaceApi: async () => ({}) }))
vi.mock("./capture", () => ({ capture: () => captured.next!() }))

const { prototypeFaceVerifier } = await import("./verifier")

function camera(): Camera & { cancel(): void; closed: boolean } {
    let reject: (e: Error) => void = () => {}
    const cancelled = new Promise<never>((_, r) => { reject = r })
    cancelled.catch(() => {})
    const cam = {
        video: {} as HTMLVideoElement, closed: false, cancelled,
        say: () => {}, close: () => { cam.closed = true },
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

describe("the prototype verifier and the camera", () => {
    it("returns no photo when the person cancels while the templates are being stored", async () => {
        const cam = camera()
        captured.next = async () => ({ live: true, descriptors: [[0.1], [0.1]], photo: "cGhvdG8=", frame: null })
        const verifier = prototypeFaceVerifier(async () => cam, slowStore())
        const enrolling = verifier.enrol(key)
        await new Promise(r => setTimeout(r, 20))
        cam.cancel()
        await expect(enrolling).rejects.toMatchObject({ message: "FACE_CANCELLED" })
        expect(cam.closed).toBe(true)
    })

    it("returns the photo when nobody cancels, and closes the camera", async () => {
        const cam = camera()
        captured.next = async () => ({ live: true, descriptors: [[0.1], [0.1]], photo: "cGhvdG8=", frame: null })
        const verifier = prototypeFaceVerifier(async () => cam, slowStore())
        expect(await verifier.enrol(key)).toEqual({ photo: "cGhvdG8=" })
        expect(cam.closed).toBe(true)
    })
})
