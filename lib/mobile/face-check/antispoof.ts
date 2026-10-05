import { resize, type Rgba } from "./image"
import type { Face, Run } from "./models"

/**
 * Passive anti-spoofing: whether one frame shows a real face or a photo or
 * screen held up to the camera, from MiniFASNet (Silent-Face-Anti-Spoofing,
 * Apache-2.0): two small models looking at the face at two crop sizes.
 *
 * A signal, not a verdict: its authors say it is only reliable on direct
 * camera captures, and on 30 ordinary photos of real people it scored some
 * well below 0.5. So a low score sends the check-in for review
 * (mobile/FACE_CHECK.md) rather than refusing the person; the blink, the turn and
 * the match are what must pass.
 */

/** The two models, by how much of the frame around the face each looks at. */
export const ANTISPOOF_MODELS = [
    { file: "minifasnet_v2_2.7.onnx", scale: 2.7 },
    { file: "minifasnet_v1se_4.0.onnx", scale: 4.0 },
] as const

/** Below this the frame is treated as possibly not a live face. */
export const LIVE_SCORE = 0.5

/**
 * The face box widened `scale` times around its centre, then moved back
 * inside the frame: the original's _get_new_box, in whole pixels, inclusive.
 */
export function cropBox(width: number, height: number, face: Face, scale: number): [number, number, number, number] {
    // As the original: x, y, w, h from the detector, whole pixels.
    const x = Math.trunc(face.box[0]), y = Math.trunc(face.box[1])
    const bw = Math.trunc(face.box[2] - face.box[0] + 1), bh = Math.trunc(face.box[3] - face.box[1] + 1)
    const s = Math.min((height - 1) / bh, Math.min((width - 1) / bw, scale))
    const nw = bw * s, nh = bh * s
    const cx = bw / 2 + x, cy = bh / 2 + y
    let x1 = cx - nw / 2, y1 = cy - nh / 2, x2 = cx + nw / 2, y2 = cy + nh / 2
    if (x1 < 0) { x2 -= x1; x1 = 0 }
    if (y1 < 0) { y2 -= y1; y1 = 0 }
    if (x2 > width - 1) { x1 -= x2 - width + 1; x2 = width - 1 }
    if (y2 > height - 1) { y1 -= y2 - height + 1; y2 = height - 1 }
    return [Math.trunc(x1), Math.trunc(y1), Math.trunc(x2), Math.trunc(y2)]
}

/** The model input: the crop at 80 × 80, planar BGR, raw 0–255 (the original doesn't scale). */
export function antispoofInput(img: Rgba, face: Face, scale: number): Float32Array {
    const [x1, y1, x2, y2] = cropBox(img.width, img.height, face, scale)
    const w = x2 - x1 + 1, h = y2 - y1 + 1
    const crop = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) crop.set(img.data.subarray(((y1 + y) * img.width + x1) * 4, ((y1 + y) * img.width + x1 + w) * 4), y * w * 4)
    const small = resize({ data: crop, width: w, height: h }, 80, 80)
    const plane = 80 * 80
    const out = new Float32Array(plane * 3)
    for (let i = 0; i < plane; i++) {
        out[i] = small.data[i * 4 + 2]
        out[plane + i] = small.data[i * 4 + 1]
        out[2 * plane + i] = small.data[i * 4]
    }
    return out
}

const softmax = (l: Float32Array) => {
    const m = Math.max(...l)
    const e = Array.from(l, v => Math.exp(v - m))
    const sum = e.reduce((a, b) => a + b, 0)
    return e.map(v => v / sum)
}

/** How sure the two models together are that this is a live face, 0 to 1. */
export async function liveScore(runs: readonly Run[], img: Rgba, face: Face): Promise<number> {
    let real = 0
    for (let i = 0; i < ANTISPOOF_MODELS.length; i++) {
        const [logits] = await runs[i](antispoofInput(img, face, ANTISPOOF_MODELS[i].scale), [1, 3, 80, 80])
        real += softmax(logits)[1]
    }
    return real / ANTISPOOF_MODELS.length
}
