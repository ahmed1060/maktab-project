import type { FaceLandmarker } from "@mediapipe/tasks-vision"
import { align, cosine, detect, embed, type Face, type Run } from "./models"
import { ANTISPOOF_MODELS, liveScore } from "./antispoof"
import type { Reading } from "./liveness"
import type { Rgba } from "./image"

/**
 * The face check's models in the phone's web view: MediaPipe's Face
 * Landmarker for the live challenge, many looks a second; InsightFace's
 * detector and ArcFace ResNet50 for who it is, and MiniFASNet for whether
 * it's a live face, on a few still frames. Everything is served by this site
 * (scripts/fetch-face-models.mjs) and kept in the phone's Cache Storage after
 * the first time: about 200 MB, once.
 *
 * FOR TESTING ONLY: the recognition weights are non-commercial (mobile/FACE_CHECK.md).
 */

export const MODELS_URL = "/face-models/v2"
const CACHE = "nizmo-face-models-v2"

/** How far the first download has got, 0 to 1, for the screen. */
export type OnProgress = (share: number) => void

export type Manifest = { files: Record<string, { parts: string[]; size: number; sha256: string }>; total: number }

const unavailable = () => Object.assign(new Error("FACE_MODELS_UNAVAILABLE"), { code: "FACE_MODELS_UNAVAILABLE" })

/** Bytes from the site, or from the phone's cache after the first time. */
async function cached(url: string, onBytes?: (n: number) => void): Promise<ArrayBuffer> {
    const cache = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => null) : null
    const hit = await cache?.match(url)
    if (hit) {
        const buf = await hit.arrayBuffer()
        onBytes?.(buf.byteLength)
        return buf
    }
    // Offline, or the connection dropped: the person is told the download failed, not a browser error.
    const res = await fetch(url).catch(() => { throw unavailable() })
    if (!res.ok || !res.body) throw unavailable()
    const chunks: Uint8Array[] = []
    const reader = res.body.getReader()
    for (;;) {
        const { done, value } = await reader.read().catch(() => { throw unavailable() })
        if (done) break
        chunks.push(value)
        onBytes?.(value.byteLength)
    }
    const buf = await new Blob(chunks as BlobPart[]).arrayBuffer()
    await cache?.put(url, new Response(buf)).catch(() => {})
    return buf
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("")

/**
 * A model served in parts, joined and checked against the manifest: a corrupted download is never run.
 * One part at a time, each copied straight into place, so a phone holds the model and one part, not
 * every part and the model too (review on #47).
 */
export async function joined(manifest: Manifest, name: string, onBytes: (n: number) => void): Promise<Uint8Array> {
    const entry = manifest.files[name]
    const out = new Uint8Array(entry.size)
    let at = 0
    for (const p of entry.parts) {
        const part = new Uint8Array(await cached(`${MODELS_URL}/${p}`, onBytes))
        if (at + part.byteLength > entry.size) { at = -1; break }
        out.set(part, at)
        at += part.byteLength
    }
    if (at !== entry.size || hex(await crypto.subtle.digest("SHA-256", out)) !== entry.sha256) {
        // Drop the cached parts so the next try downloads them afresh.
        const cache = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => null) : null
        await Promise.all(entry.parts.map(p => cache?.delete(`${MODELS_URL}/${p}`)))
        throw Object.assign(new Error("FACE_MODELS_CORRUPT"), { code: "FACE_MODELS_CORRUPT" })
    }
    return out
}

/** What the site serves, never cached: offline, missing or not JSON is FACE_MODELS_UNAVAILABLE (review on #47). */
export async function manifestOf(): Promise<Manifest> {
    try {
        const res = await fetch(`${MODELS_URL}/manifest.json`, { cache: "no-store" })
        if (!res.ok) throw unavailable()
        const m = (await res.json()) as Manifest
        if (!m?.files || typeof m.total !== "number") throw unavailable()
        return m
    } catch {
        throw unavailable()
    }
}

export type Engine = {
    /** One look for the live challenge: how many faces, and for exactly one, its reading. */
    read(video: HTMLVideoElement, at: number): { faces: number; reading: Reading | null }
    /** Who is in this still frame (512 numbers), and how sure the anti-spoofing is it's a live face. */
    identify(frame: Rgba): Promise<{ faces: number; embedding: number[] | null; live: number | null }>
}

let loading: Promise<Engine> | null = null

/** Loads everything once per app session; a failure lets the next try start over. */
export function loadEngine(onProgress?: OnProgress): Promise<Engine> {
    loading ??= build(onProgress).catch(e => { loading = null; throw e })
    return loading
}

async function build(onProgress?: OnProgress): Promise<Engine> {
    const ort = await import("onnxruntime-web/wasm")
    ort.env.wasm.wasmPaths = `${MODELS_URL}/ort/`
    // One thread: a web view isn't cross-origin isolated, so it couldn't share memory between threads anyway.
    ort.env.wasm.numThreads = 1

    const manifest = await manifestOf()
    const total = manifest.total
    let got = 0
    const onBytes = (n: number) => { got += n; onProgress?.(Math.min(1, got / total)) }

    const session = async (bytes: Uint8Array | ArrayBuffer): Promise<Run> => {
        const s = await ort.InferenceSession.create(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { executionProviders: ["wasm"] })
        return async (input, dims) => {
            const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, dims as number[]) })
            return s.outputNames.map(n => out[n].data as Float32Array)
        }
    }
    // One model at a time: each one's bytes can go once its session holds them, keeping the peak low on a phone.
    const det = await session(await joined(manifest, "det_10g.onnx", onBytes))
    const rec = await session(await joined(manifest, "w600k_r50.onnx", onBytes))
    const fas: Run[] = []
    for (const m of ANTISPOOF_MODELS) fas.push(await session(await cached(`${MODELS_URL}/${m.file}`, onBytes)))
    const landmarker = await faceLandmarker(onBytes)

    return {
        read(video, at) {
            const r = landmarker.detectForVideo(video, at)
            const faces = r.faceLandmarks.length
            if (faces !== 1) return { faces, reading: null }
            return { faces, reading: readingOf(r.faceLandmarks[0], r.faceBlendshapes[0]?.categories ?? []) }
        },
        async identify(frame) {
            const found = await detect(det, frame)
            if (found.length !== 1) return { faces: found.length, embedding: null, live: null }
            const face: Face = found[0]
            const [embedding, live] = await Promise.all([embed(rec, align(frame, face)), liveScore(fas, frame, face)])
            return { faces: 1, embedding, live }
        },
    }
}

async function faceLandmarker(onBytes: (n: number) => void): Promise<FaceLandmarker> {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision")
    const files = await FilesetResolver.forVisionTasks(`${MODELS_URL}/mediapipe`)
    const model = new Uint8Array(await cached(`${MODELS_URL}/face_landmarker.task`, onBytes))
    const options = (delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetBuffer: model, delegate },
        runningMode: "VIDEO" as const,
        // Two, so a second face is seen and the check refuses it.
        numFaces: 2,
        outputFaceBlendshapes: true,
    })
    // The GPU where the web view offers it; older phones fall back to the processor.
    return FaceLandmarker.createFromOptions(files, options("GPU")).catch(() => FaceLandmarker.createFromOptions(files, options("CPU")))
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
