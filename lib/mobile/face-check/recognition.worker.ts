/// <reference lib="webworker" />
import { manifestOf, runtime, ORT_WASM } from "./files"
import { recognizer, type Recognizer } from "./recognizer"

/**
 * The recognition models, in a worker of their own (engine.ts): loading them and
 * running them takes seconds on a phone's single thread, and on the page's thread
 * it froze the camera's picture and the challenge with it.
 *
 * Messages in: { type: "load" }, { type: "identify", id, frame }.
 * Messages out: { type: "progress", bytes }, { type: "ready" }, { type: "failed", code },
 * { type: "identified", id, result } or { type: "identified", id, code }.
 */

declare const self: DedicatedWorkerGlobalScope

let ready: Promise<Recognizer> | null = null

async function load(): Promise<Recognizer> {
    const ort = await import("onnxruntime-web/wasm")
    const manifest = await manifestOf()
    const progress = (bytes: number) => self.postMessage({ type: "progress", bytes })
    // Its WebAssembly from the phone's cache (files.ts), not left to the browser's own; the loader for it is
    // built into this script, so nothing else is fetched (review on #48).
    ort.env.wasm.wasmBinary = new Uint8Array(await runtime(manifest, ORT_WASM, progress))
    // One thread: a web view isn't cross-origin isolated, so it couldn't share memory between threads anyway.
    ort.env.wasm.numThreads = 1
    // Not a warning per look: the detector's outputs are declared for 640 × 640, and it runs at 320 (recognizer.ts).
    ort.env.logLevel = "error"
    return recognizer(ort, manifest, progress)
}

const codeOf = (e: unknown) => (e as { code?: string })?.code ?? "FACE_MODELS_UNAVAILABLE"

self.onmessage = async (e: MessageEvent) => {
    const m = e.data
    if (m.type === "load") {
        ready ??= load().catch(err => { ready = null; throw err })
        ready.then(() => self.postMessage({ type: "ready" }), err => self.postMessage({ type: "failed", code: codeOf(err) }))
    } else if (m.type === "identify") {
        try {
            const run = await (ready ?? Promise.reject(Object.assign(new Error("not loaded"), { code: "FACE_MODELS_UNAVAILABLE" })))
            self.postMessage({ type: "identified", id: m.id, result: await run(m.frame) })
        } catch (err) {
            self.postMessage({ type: "identified", id: m.id, code: codeOf(err) })
        }
    }
}
