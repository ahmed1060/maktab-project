import { describe, it, expect, vi } from "vitest"

/**
 * The recognition worker, as the page talks to it (engine.ts): a worker that
 * stops after it loaded (a crash, the phone out of memory) must not leave a
 * check waiting for ever (review on #48).
 */

vi.mock("@mediapipe/tasks-vision", () => ({}))
const { inWorker } = await import("./engine")

/** A worker that loads at once and answers nothing after: what a crashed one looks like from the page. */
function worker() {
    const w = {
        onmessage: null as null | ((e: MessageEvent) => void),
        onerror: null as null | ((e: unknown) => void),
        terminated: false,
        postMessage(m: { type: string }) { if (m.type === "load") queueMicrotask(() => w.onmessage?.({ data: { type: "ready" } } as MessageEvent)) },
        terminate() { w.terminated = true },
    }
    return w
}

const frame = { data: new Uint8ClampedArray(4), width: 1, height: 1 }

describe("a recognition worker that stops", () => {
    it("fails what was waiting, and anything asked of it after, and says so", async () => {
        const w = worker()
        let dead = 0
        const identify = await inWorker(w as unknown as Worker, () => {}, () => { dead++ })
        const waiting = identify(frame)
        w.onerror?.(new Event("error"))
        await expect(waiting).rejects.toMatchObject({ code: "FACE_MODELS_UNAVAILABLE" })
        await expect(identify(frame)).rejects.toMatchObject({ code: "FACE_MODELS_UNAVAILABLE" })
        expect(dead).toBe(1)
        expect(w.terminated).toBe(true)
    })
})
