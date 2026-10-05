/**
 * Pixels as the face check reads them: RGBA, row by row, as a canvas gives
 * them (getImageData) and as sharp gives them in the tests. Nothing here
 * touches the DOM, so the same code runs on the phone and in Node.
 */
export type Rgba = { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

/** One channel at a fractional position, bilinear; `outside` beyond the edge. */
function sample(img: Rgba, x: number, y: number, c: number, outside: number): number {
    const x0 = Math.floor(x), y0 = Math.floor(y)
    const fx = x - x0, fy = y - y0
    const at = (xx: number, yy: number) =>
        xx < 0 || yy < 0 || xx >= img.width || yy >= img.height ? outside : img.data[(yy * img.width + xx) * 4 + c]
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
}

/**
 * Resized to width × height, bilinear, as OpenCV's INTER_LINEAR does it
 * (pixel centres aligned, edges clamped): the reference pipeline
 * (InsightFace, in Python) resizes with OpenCV, and matching it closely is
 * what keeps the recognition as accurate here as there.
 */
export function resize(img: Rgba, width: number, height: number): Rgba {
    const out = new Uint8ClampedArray(width * height * 4)
    const sx = img.width / width, sy = img.height / height
    for (let y = 0; y < height; y++) {
        const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), img.height - 1)
        for (let x = 0; x < width; x++) {
            const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), img.width - 1)
            for (let c = 0; c < 4; c++) out[(y * width + x) * 4 + c] = Math.round(sample(img, fx, fy, c, 0))
        }
    }
    return { data: out, width, height }
}

/** A 2×3 affine matrix, [a, b, c, d, e, f]: x' = a·x + b·y + c, y' = d·x + e·y + f. */
export type Affine = readonly [number, number, number, number, number, number]

/**
 * The image under an affine map into a width × height output, bilinear,
 * black outside: what OpenCV's warpAffine does with its defaults, which is
 * how the reference cuts the 112×112 face out for recognition.
 */
export function warp(img: Rgba, m: Affine, width: number, height: number): Rgba {
    const [a, b, c, d, e, f] = m
    const det = a * e - b * d
    // Each output pixel reads from where the inverse map sends it.
    const ia = e / det, ib = -b / det, id = -d / det, ie = a / det
    const ic = -(ia * c + ib * f), iff = -(id * c + ie * f)
    const out = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const sx = ia * x + ib * y + ic, sy = id * x + ie * y + iff
            const o = (y * width + x) * 4
            for (let ch = 0; ch < 3; ch++) out[o + ch] = Math.round(sample(img, sx, sy, ch, 0))
            out[o + 3] = 255
        }
    }
    return { data: out, width, height }
}

/**
 * The model input: planar RGB (N, C, H, W), each value (pixel − mean) / std,
 * as OpenCV's blobFromImage with swapRB builds it for the reference.
 */
export function blob(img: Rgba, mean: number, std: number): Float32Array {
    const plane = img.width * img.height
    const out = new Float32Array(plane * 3)
    for (let i = 0; i < plane; i++) {
        out[i] = (img.data[i * 4] - mean) / std
        out[plane + i] = (img.data[i * 4 + 1] - mean) / std
        out[2 * plane + i] = (img.data[i * 4 + 2] - mean) / std
    }
    return out
}
