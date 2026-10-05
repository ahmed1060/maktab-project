import { describe, it, expect } from "vitest"
import { ARCFACE_POINTS, cosine, detect, embed, similarity, type Run } from "./models"
import { blob, resize, warp, type Rgba } from "./image"

/**
 * The face check's recognition steps without the models: the arithmetic that
 * has to agree with InsightFace's reference for its accuracy to carry over.
 * (Run on real photos against the reference by scripts/face-check-eval.mts:
 * 30 photos, embeddings within 0.996 of the reference's, every same/different
 * pair on the right side of the threshold.)
 */

const apply = (m: readonly number[], p: { x: number; y: number }) => ({ x: m[0] * p.x + m[1] * p.y + m[2], y: m[3] * p.x + m[4] * p.y + m[5] })
const solid = (w: number, h: number, rgb: [number, number, number]): Rgba => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4)
    return { data, width: w, height: h }
}

describe("alignment", () => {
    it("recovers a rotation, scale and shift exactly", () => {
        // Points made by a known similarity transform: estimating it back must give it.
        const angle = 0.3, s = 2.5, tx = 40, ty = -12
        const known = [s * Math.cos(angle), -s * Math.sin(angle), tx, s * Math.sin(angle), s * Math.cos(angle), ty]
        const to = ARCFACE_POINTS.map(p => apply(known, p))
        const m = similarity(ARCFACE_POINTS, to)
        m.forEach((v, i) => expect(v).toBeCloseTo(known[i], 9))
    })

    it("carries a face's five points onto ArcFace's", () => {
        const face = [{ x: 210, y: 300 }, { x: 330, y: 290 }, { x: 275, y: 370 }, { x: 225, y: 440 }, { x: 320, y: 432 }]
        const m = similarity(face, ARCFACE_POINTS)
        face.forEach((p, i) => {
            const q = apply(m, p)
            // Least squares over five points: close, not exact.
            expect(Math.hypot(q.x - ARCFACE_POINTS[i].x, q.y - ARCFACE_POINTS[i].y)).toBeLessThan(3)
        })
    })
})

describe("pixels", () => {
    it("warps with black outside the image, as OpenCV's warpAffine does", () => {
        const out = warp(solid(10, 10, [200, 100, 50]), [1, 0, 50, 0, 1, 50], 4, 4)
        expect(Array.from(out.data.slice(0, 4))).toEqual([0, 0, 0, 255])
        const inside = warp(solid(10, 10, [200, 100, 50]), [1, 0, 0, 0, 1, 0], 4, 4)
        expect(Array.from(inside.data.slice(0, 3))).toEqual([200, 100, 50])
    })

    it("resizes a flat colour to the same colour", () => {
        const out = resize(solid(37, 23, [10, 20, 30]), 64, 40)
        expect(out.width).toBe(64)
        expect(Array.from(out.data.slice(4 * 100, 4 * 100 + 3))).toEqual([10, 20, 30])
    })

    it("builds planar RGB normalised as (pixel - mean) / std", () => {
        const b = blob(solid(2, 1, [255, 0, 255]), 127.5, 127.5)
        expect(Array.from(b)).toEqual([1, 1, -1, -1, 1, 1])
    })
})

describe("detection", () => {
    it("decodes a face from SCRFD's anchors, back in the photo's own pixels", async () => {
        // A 1280 × 640 photo is halved to fit 640: everything comes back doubled.
        const outs = [8, 16, 32].map(stride => ((640 / stride) ** 2) * 2)
        const run: Run = async () => {
            const score = outs.map(n => new Float32Array(n)), box = outs.map(n => new Float32Array(n * 4)), kps = outs.map(n => new Float32Array(n * 10))
            // One confident anchor at stride 16, cell (x 10, y 5), first anchor: centre (160, 80).
            const k = (5 * 40 + 10) * 2
            score[1][k] = 0.9
            box[1].set([2, 3, 4, 5], k * 4)
            kps[1].set([-1, -1, 1, -1, 0, 0, -1, 1, 1, 1], k * 10)
            return [...score, ...box, ...kps]
        }
        const [face, ...rest] = await detect(run, solid(1280, 640, [0, 0, 0]))
        expect(rest).toEqual([])
        expect(face.score).toBeCloseTo(0.9)
        expect(face.box).toEqual([(160 - 32) * 2, (80 - 48) * 2, (160 + 64) * 2, (80 + 80) * 2])
        expect(face.points[0]).toEqual({ x: (160 - 16) * 2, y: (80 - 16) * 2 })
    })

    it("keeps one box per face", async () => {
        const run: Run = async () => {
            const n = 80 * 80 * 2
            const score = [new Float32Array(n), new Float32Array(n / 4), new Float32Array(n / 16)]
            const box = [new Float32Array(n * 4), new Float32Array(n), new Float32Array(n / 4)]
            const kps = [new Float32Array(n * 10), new Float32Array(n * 10 / 4), new Float32Array(n * 10 / 16)]
            // The same place found by both anchors of one cell.
            for (const [k, s] of [[100, 0.8], [101, 0.95]]) { score[0][k] = s; box[0].set([5, 5, 5, 5], k * 4) }
            return [...score, ...box, ...kps]
        }
        const faces = await detect(run, solid(640, 640, [0, 0, 0]))
        expect(faces.map(f => f.score.toFixed(2))).toEqual(["0.95"])
    })
})

describe("recognition", () => {
    it("gives 512 numbers of length 1, compared by cosine", async () => {
        const run: Run = async () => [Float32Array.from({ length: 512 }, (_, i) => (i % 7) - 3)]
        const e = await embed(run, solid(112, 112, [0, 0, 0]))
        expect(e).toHaveLength(512)
        expect(cosine(e, e)).toBeCloseTo(1, 6)
        expect(cosine(e, e.map(v => -v))).toBeCloseTo(-1, 6)
        expect(cosine(e, [1, 2])).toBe(-1)
    })
})
