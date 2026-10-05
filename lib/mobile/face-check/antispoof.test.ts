import { describe, it, expect } from "vitest"
import { cropBox, antispoofInput, liveScore } from "./antispoof"
import type { Face, Run } from "./models"

/**
 * The anti-spoofing crop and input as the original (Silent-Face) makes them.
 * On photos, run by scripts/face-check-eval.mts, the scores match the
 * original's within 0.01 (its fake samples 0.00 and 0.17, its real one 1.00).
 */

const face = (x1: number, y1: number, x2: number, y2: number): Face => ({ box: [x1, y1, x2, y2], score: 0.9, points: Array(5).fill({ x: 0, y: 0 }) as Face["points"] })

describe("the crop", () => {
    it("widens the box around its centre", () => {
        // 101 × 101 box centred at (350.5, 250.5), 2.7×: 272.7 wide.
        expect(cropBox(1000, 1000, face(300, 200, 400, 300), 2.7)).toEqual([214, 114, 486, 386])
    })

    it("moves it back inside the frame rather than cutting it", () => {
        const [x1, y1, x2, y2] = cropBox(640, 480, face(10, 10, 110, 110), 4)
        expect([x1, y1]).toEqual([0, 0])
        expect(x2 - x1).toBeCloseTo(404, 0)
        expect(y2 - y1).toBeCloseTo(404, 0)
    })

    it("never asks for more than the frame holds", () => {
        const [x1, y1, x2, y2] = cropBox(320, 240, face(100, 60, 220, 200), 4)
        expect(x1).toBeGreaterThanOrEqual(0)
        expect(y2).toBeLessThanOrEqual(239)
        expect(x2).toBeLessThanOrEqual(319)
        expect(y1).toBeGreaterThanOrEqual(0)
    })
})

describe("the input", () => {
    it("is planar BGR, raw 0 to 255", () => {
        const data = new Uint8ClampedArray(200 * 200 * 4)
        for (let i = 0; i < 200 * 200; i++) data.set([200, 100, 50, 255], i * 4)
        const x = antispoofInput({ data, width: 200, height: 200 }, face(50, 50, 150, 150), 2.7)
        expect([x[0], x[6400], x[12800]]).toEqual([50, 100, 200])
    })

    it("averages the two models' 'real' probability", async () => {
        const sure: Run = async () => [Float32Array.from([0, 10, 0])]
        const unsure: Run = async () => [Float32Array.from([0, 0, 0])]
        const img = { data: new Uint8ClampedArray(100 * 100 * 4), width: 100, height: 100 }
        expect(await liveScore([sure, unsure], img, face(30, 30, 70, 70))).toBeCloseTo((1 + 1 / 3) / 2, 3)
    })
})
