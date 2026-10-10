import { align, detect, embed, type Face, type Run } from "./models"
import { ANTISPOOF_MODELS, liveScore } from "./antispoof"
import { cached, joined, MODELS_URL, type Manifest } from "./files"
import type { Rgba } from "./image"

/**
 * Who is in a still frame: InsightFace's detector and ArcFace ResNet50, and
 * MiniFASNet for whether it's a live face. Run in a worker (recognition.worker.ts),
 * away from the screen, so the picture never stops while it works.
 */

/**
 * The detector looks at 320 × 320: a face at arm's length fills the frame. On 30
 * photos framed as a front camera frames them it found every face as 640 did, at a
 * quarter of the time, and every same-or-not decision at 0.40 came out the same.
 */
export const DETECT_SIZE = 320

export type Identified = { faces: number; embedding: number[] | null; live: number | null }
export type Recognizer = (frame: Rgba) => Promise<Identified>

type Ort = typeof import("onnxruntime-web/wasm")

/** Sessions for every model, one model at a time: each one's bytes can go once its session holds them. */
export async function recognizer(ort: Ort, manifest: Manifest, onBytes: (n: number) => void): Promise<Recognizer> {
    const session = async (bytes: Uint8Array): Promise<Run> => {
        // Errors only: the detector's outputs are declared for 640 × 640 and it runs at 320 (DETECT_SIZE), which
        // the session warns about at every look. The session's own level, which env.logLevel doesn't set.
        const s = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], logSeverityLevel: 3 })
        return async (input, dims) => {
            const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, dims as number[]) })
            return s.outputNames.map(n => out[n].data as Float32Array)
        }
    }
    const det = await session(await joined(manifest, "det_10g.onnx", onBytes))
    const rec = await session(await joined(manifest, "w600k_r50.onnx", onBytes))
    const fas: Run[] = []
    for (const m of ANTISPOOF_MODELS) fas.push(await session(new Uint8Array((await cached(`${MODELS_URL}/${m.file}`, onBytes)).bytes)))
    return async frame => {
        const found = await detect(det, frame, DETECT_SIZE)
        if (found.length !== 1) return { faces: found.length, embedding: null, live: null }
        const face: Face = found[0]
        const [embedding, live] = await Promise.all([embed(rec, align(frame, face)), liveScore(fas, frame, face)])
        return { faces: 1, embedding, live }
    }
}
