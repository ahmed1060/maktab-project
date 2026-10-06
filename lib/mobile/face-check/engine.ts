import type { FaceLandmarker } from "@mediapipe/tasks-vision"
import { cosine } from "./models"
import { cached, manifestOf, MODELS_URL, onPhone, type OnProgress } from "./files"
import type { Identified, Recognizer } from "./recognizer"
import type { Reading } from "./liveness"
import type { Rgba } from "./image"

/**
 * The face check's models in the phone's web view: MediaPipe's Face
 * Landmarker for the live challenge, many looks a second, on the page; and
 * the recognition models (recognizer.ts) in a worker of their own, so the
 * picture and the challenge never stop while they work. Everything is served
 * by this site (scripts/fetch-face-models.mjs) and kept in the phone's Cache
 * Storage after the first time: about 200 MB, once.
 *
 * FOR TESTING ONLY: the recognition weights are non-commercial (mobile/FACE_CHECK.md).
 */

export { MODELS_URL, joined, manifestOf, type Manifest, type OnProgress } from "./files"

export type Engine = {
    /** One look for the live challenge: how many faces, and for exactly one, its reading. */
    read(video: HTMLVideoElement, at: number): { faces: number; reading: Reading | null }
    /** Who is in this still frame (512 numbers), and how sure the anti-spoofing is it's a live face. */
    identify(frame: Rgba): Promise<Identified>
}

let loading: Promise<Engine> | null = null

/** Loads everything once per app session; a failure lets the next try start over. */
export function loadEngine(onProgress?: OnProgress): Promise<Engine> {
    loading ??= build(onProgress).catch(e => { loading = null; throw e })
    return loading
}

/**
 * Loads the engine ahead of the camera when the models are on the phone already,
 * so opening the camera doesn't wait for it; never downloads: that waits for the
 * person to ask, with its progress on the screen.
 */
export async function warmEngine(): Promise<void> {
    if (loading) return
    const manifest = await manifestOf().catch(() => null)
    if (manifest && (await onPhone(manifest))) await loadEngine().catch(() => {})
}

async function build(onProgress?: OnProgress): Promise<Engine> {
    const manifest = await manifestOf()
    let got = 0
    const onBytes = (n: number) => { got += n; onProgress?.(Math.min(1, got / manifest.total)) }
    const [identify, landmarker] = await Promise.all([recognition(onBytes), faceLandmarker(onBytes)])
    return {
        read(video, at) {
            const r = landmarker.detectForVideo(video, at)
            const faces = r.faceLandmarks.length
            if (faces !== 1) return { faces, reading: null }
            return { faces, reading: readingOf(r.faceLandmarks[0], r.faceBlendshapes[0]?.categories ?? []) }
        },
        identify,
    }
}

/** The recognition models on the page itself: where there are no workers, or the worker wouldn't start. */
async function onPage(onBytes: (n: number) => void): Promise<Recognizer> {
    const ort = await import("onnxruntime-web/wasm")
    ort.env.wasm.wasmPaths = `${MODELS_URL}/ort/`
    ort.env.wasm.numThreads = 1
    ort.env.logLevel = "error"
    const { recognizer } = await import("./recognizer")
    return recognizer(ort, await manifestOf(), onBytes)
}

/**
 * The recognition models in their worker, bundled by scripts/fetch-face-models.mjs
 * beside the models; on the page itself where there are no workers, or the worker
 * wouldn't start. A model that wouldn't load is a failure either way.
 */
async function recognition(onBytes: (n: number) => void): Promise<Recognizer> {
    if (typeof Worker === "undefined") return onPage(onBytes)
    const worker = new Worker(`${MODELS_URL}/recognition-worker.mjs`, { type: "module" })
    return inWorker(worker, onBytes).catch(e => ((e as { code?: string }).code === "FACE_WORKER_FAILED" ? onPage(onBytes) : Promise.reject(e)))
}

async function inWorker(worker: Worker, onBytes: (n: number) => void): Promise<Recognizer> {
    const waiting = new Map<number, { resolve: (r: Identified) => void; reject: (e: Error) => void }>()
    let next = 0
    await new Promise<void>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent) => {
            const m = e.data
            if (m.type === "progress") onBytes(m.bytes)
            else if (m.type === "ready") resolve()
            else if (m.type === "failed") { worker.terminate(); reject(Object.assign(new Error(m.code), { code: m.code })) }
            else if (m.type === "identified") {
                const w = waiting.get(m.id)
                waiting.delete(m.id)
                if (m.code) w?.reject(Object.assign(new Error(m.code), { code: m.code }))
                else w?.resolve(m.result)
            }
        }
        // The worker's own script wouldn't run: the page does the work instead.
        worker.onerror = () => { worker.terminate(); reject(Object.assign(new Error("FACE_WORKER_FAILED"), { code: "FACE_WORKER_FAILED" })) }
        worker.postMessage({ type: "load" })
    })
    // Gone after loading: whatever was waiting on it fails rather than waiting for ever.
    worker.onerror = () => {
        for (const w of waiting.values()) w.reject(Object.assign(new Error("FACE_MODELS_UNAVAILABLE"), { code: "FACE_MODELS_UNAVAILABLE" }))
        waiting.clear()
    }
    return frame => new Promise((resolve, reject) => {
        const id = ++next
        waiting.set(id, { resolve, reject })
        // The pixels move to the worker rather than being copied: a frame is several megabytes.
        const data = new Uint8ClampedArray(frame.data)
        worker.postMessage({ type: "identify", id, frame: { data, width: frame.width, height: frame.height } }, [data.buffer])
    })
}

async function faceLandmarker(onBytes: (n: number) => void): Promise<FaceLandmarker> {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision")
    const files = await FilesetResolver.forVisionTasks(`${MODELS_URL}/mediapipe`)
    const model = new Uint8Array((await cached(`${MODELS_URL}/face_landmarker.task`, onBytes)).bytes)
    const options = (delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetBuffer: model, delegate },
        runningMode: "VIDEO" as const,
        // Two, so a second face is seen and the check refuses it.
        numFaces: 2,
        outputFaceBlendshapes: true,
    })
    // The GPU where the web view offers it; older phones fall back to the processor.
    const landmarker = await FaceLandmarker.createFromOptions(files, options("GPU")).catch(() => FaceLandmarker.createFromOptions(files, options("CPU")))
    // Its first look sets it up on the graphics chip, seconds on its own: done now, on a blank picture, rather than
    // with the person in front of the camera. Later looks carry on from a later time, as video mode needs.
    try {
        const blank = document.createElement("canvas")
        blank.width = blank.height = 64
        landmarker.detectForVideo(blank, performance.now())
    } catch { /* a first look that fails here just happens with the camera instead */ }
    return landmarker
}

type Lm = { x: number; y: number }
type Category = { categoryName: string; score: number }

/** MediaPipe's points: 1 the nose tip, 33 and 263 the outer eye corners. */
export function readingOf(points: readonly Lm[], blendshapes: readonly Category[]): Reading {
    const score = (name: string) => blendshapes.find(c => c.categoryName === name)?.score ?? 0
    const a = points[33], b = points[263], nose = points[1]
    const span = b.x - a.x
    return {
        eyes: (score("eyeBlinkLeft") + score("eyeBlinkRight")) / 2,
        turn: span === 0 ? 0.5 : (nose.x - a.x) / span,
    }
}

/** The video's current frame as pixels, at most 1280 wide: plenty for a face held at arm's length. */
export function grab(video: HTMLVideoElement): Rgba {
    const scale = Math.min(1, 1280 / (video.videoWidth || 1280))
    const w = Math.round((video.videoWidth || 640) * scale), h = Math.round((video.videoHeight || 480) * scale)
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!
    ctx.drawImage(video, 0, 0, w, h)
    return ctx.getImageData(0, 0, w, h)
}

export { cosine }
