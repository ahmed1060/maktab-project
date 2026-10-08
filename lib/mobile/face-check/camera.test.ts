import { describe, it, expect } from "vitest"
import { ringShare } from "./camera"

/** The ring around the oval on the camera screen (components/FaceCamera.tsx). */

describe("the ring around the oval", () => {
    it("shows the capture's share, and all of it once done", () => {
        expect(ringShare(0.5, false, false)).toBe(0.5)
        expect(ringShare(0, false, false)).toBe(0)
        expect(ringShare(null, true, false)).toBe(1)
    })

    it("shows whole while a step's cue flashes it, though the step cleared the share (review on #48)", () => {
        expect(ringShare(null, false, true)).toBe(1)
        expect(ringShare(null, false, false)).toBe(0)
        // During the looks, a flash doesn't overstate how far the capture has got.
        expect(ringShare(0.25, false, true)).toBe(0.25)
    })
})
