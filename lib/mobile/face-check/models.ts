import { blob, resize, warp, type Affine, type Rgba } from "./image"

/**
 * The face check's two recognition models, InsightFace's "buffalo_l" pack:
 * SCRFD-10GF finds faces and five points on each, and an ArcFace ResNet50
 * trained on WebFace600K turns the aligned face into 512 numbers. On
 * InsightFace's own benchmarks it is among the most accurate open models
 * (LFW 99.83%, CFP-FP 99.33%, AgeDB-30 98.23%, IJB-C 97.25%).
 *
 * FOR TESTING ONLY: the weights are licensed for non-commercial research. The
 * feature is replaced by a paid SDK before release (mobile/FACE_CHECK.md).
 *
 * Every step copies the reference pipeline (insightface 0.7.3, Python): the
 * same resize, padding, normalisation, anchor decoding and alignment, so the
 * numbers here are the numbers the benchmarks describe.
 */

/** Runs one model on one input and gives back its outputs, in the model's order. */
export type Run = (input: Float32Array, dims: readonly number[]) => Promise<Float32Array[]>

export type Point = { x: number; y: number }
/** A face found: its box, how sure the detector is, and five points: eyes, nose, mouth corners. */
export type Face = { box: [number, number, number, number]; score: number; points: [Point, Point, Point, Point, Point] }

const DET_SIZE = 640
const DET_THRESHOLD = 0.5
const NMS_THRESHOLD = 0.4
const STRIDES = [8, 16, 32] as const
const ANCHORS = 2

/** Faces in the image, most confident first, looked for at `size` × `size` (a multiple of 32). */
export async function detect(run: Run, img: Rgba, size: number = DET_SIZE): Promise<Face[]> {
    const DET_SIZE = size
    // Fit inside size × size keeping the shape; the rest stays black (top-left placed), as the reference does.
    const ratio = img.height / img.width
    const w = ratio > 1 ? Math.floor(DET_SIZE / ratio) : DET_SIZE
    const h = ratio > 1 ? DET_SIZE : Math.floor(DET_SIZE * ratio)
    const scale = h / img.height
    const small = resize(img, w, h)
    const padded = new Uint8ClampedArray(DET_SIZE * DET_SIZE * 4)
    for (let y = 0; y < h; y++) padded.set(small.data.subarray(y * w * 4, (y + 1) * w * 4), y * DET_SIZE * 4)
    const out = await run(blob({ data: padded, width: DET_SIZE, height: DET_SIZE }, 127.5, 128), [1, 3, DET_SIZE, DET_SIZE])

    const found: Face[] = []
    STRIDES.forEach((stride, i) => {
        const scores = out[i], boxes = out[i + 3], points = out[i + 6]
        const cols = DET_SIZE / stride
        for (let k = 0; k < scores.length; k++) {
            if (scores[k] < DET_THRESHOLD) continue
            // Anchor centres row by row, each repeated once per anchor.
            const cell = Math.floor(k / ANCHORS)
            const cx = (cell % cols) * stride, cy = Math.floor(cell / cols) * stride
            const d = (j: number) => boxes[k * 4 + j] * stride
            const p = (j: number): Point => ({ x: (cx + points[k * 10 + j * 2] * stride) / scale, y: (cy + points[k * 10 + j * 2 + 1] * stride) / scale })
            found.push({
                box: [(cx - d(0)) / scale, (cy - d(1)) / scale, (cx + d(2)) / scale, (cy + d(3)) / scale],
                score: scores[k],
                points: [p(0), p(1), p(2), p(3), p(4)],
            })
        }
    })
    return nms(found.sort((a, b) => b.score - a.score))
}

/** Overlapping boxes of one face reduced to the most confident, as the reference does (areas counted inclusively). */
function nms(faces: Face[]): Face[] {
    const area = (b: Face["box"]) => (b[2] - b[0] + 1) * (b[3] - b[1] + 1)
    const kept: Face[] = []
    for (const f of faces) {
        const overlaps = kept.some(k => {
            const w = Math.max(0, Math.min(f.box[2], k.box[2]) - Math.max(f.box[0], k.box[0]) + 1)
            const h = Math.max(0, Math.min(f.box[3], k.box[3]) - Math.max(f.box[1], k.box[1]) + 1)
            const inter = w * h
            return inter / (area(f.box) + area(k.box) - inter) > NMS_THRESHOLD
        })
        if (!overlaps) kept.push(f)
    }
    return kept
}

/** Where ArcFace expects the five points in its 112 × 112 face. */
export const ARCFACE_POINTS: readonly Point[] = [
    { x: 38.2946, y: 51.6963 }, { x: 73.5318, y: 51.5014 }, { x: 56.0252, y: 71.7366 },
    { x: 41.5493, y: 92.3655 }, { x: 70.7299, y: 92.2041 },
]

/**
 * The rotation, scale and shift that best carry `from` onto `to` (least
 * squares; no reflection), as a 2×3 matrix: the similarity transform the
 * reference estimates for alignment.
 */
export function similarity(from: readonly Point[], to: readonly Point[]): Affine {
    const n = from.length
    const mean = (ps: readonly Point[]) => ps.reduce((m, p) => ({ x: m.x + p.x / n, y: m.y + p.y / n }), { x: 0, y: 0 })
    const ms = mean(from), md = mean(to)
    let num = 0, cross = 0, den = 0
    for (let i = 0; i < n; i++) {
        const sx = from[i].x - ms.x, sy = from[i].y - ms.y
        const dx = to[i].x - md.x, dy = to[i].y - md.y
        num += sx * dx + sy * dy
        cross += sx * dy - sy * dx
        den += sx * sx + sy * sy
    }
    const a = num / den, b = cross / den
    return [a, -b, md.x - (a * ms.x - b * ms.y), b, a, md.y - (b * ms.x + a * ms.y)]
}

/** The face cut out and turned upright, 112 × 112, as ArcFace was trained on. */
export function align(img: Rgba, face: Face): Rgba {
    return warp(img, similarity(face.points, ARCFACE_POINTS), 112, 112)
}

/** The face as 512 numbers of length 1: the same person's lie close together. */
export async function embed(run: Run, aligned: Rgba): Promise<number[]> {
    const [out] = await run(blob(aligned, 127.5, 127.5), [1, 3, 112, 112])
    let norm = 0
    for (const v of out) norm += v * v
    norm = Math.sqrt(norm)
    return Array.from(out, v => v / norm)
}

/** How alike two faces are: 1 the same picture, about 0 for strangers. */
export function cosine(a: readonly number[], b: readonly number[]): number {
    if (a.length !== b.length || a.length === 0) return -1
    let s = 0
    for (let i = 0; i < a.length; i++) s += a[i] * b[i]
    return s
}
