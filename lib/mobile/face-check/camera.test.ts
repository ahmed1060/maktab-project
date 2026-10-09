import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { ringShare, startCamera } from "./camera"

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

describe("starting the camera for a capture (review on #28)", () => {
    // A stream whose tracks say when they are stopped, and a step that waits until let go.
    const media = () => {
        const stopped: boolean[] = [false]
        return { stopped, stream: { getTracks: () => [{ stop: () => { stopped[0] = true } }] } as unknown as MediaStream }
    }
    const waiting = <T,>() => { let go!: (v: T) => void; const p = new Promise<T>(r => { go = r }); return { p, go } }
    const code = (p: Promise<unknown>) => p.then(() => "STARTED", (e: { code?: string }) => e.code)

    it("is turned off and refused as cancelled when the page leaves while the camera is asked for", async () => {
        // It stopped the tracks and returned, and the capture waited for good.
        const m = media(), asked = waiting<MediaStream>()
        let gone = false, played = false
        const started = code(startCamera(() => asked.p, async () => { played = true }, () => gone))
        gone = true
        asked.go(m.stream)
        expect(await started).toBe("FACE_CANCELLED")
        expect(m.stopped[0]).toBe(true)
        expect(played).toBe(false)
    })

    it("is turned off and refused as cancelled when the page leaves while the picture starts", async () => {
        // It went on to hand a capture a camera the page's clean-up had already turned off.
        const m = media(), playing = waiting<void>()
        let gone = false
        const started = code(startCamera(async () => m.stream, () => playing.p, () => gone))
        await Promise.resolve()
        gone = true
        playing.go()
        expect(await started).toBe("FACE_CANCELLED")
        expect(m.stopped[0]).toBe(true)
    })

    it("is refused as denied, and off, when the camera is refused or won't play", async () => {
        expect(await code(startCamera(() => Promise.reject(new Error("NotAllowedError")), async () => {}, () => false))).toBe("CAMERA_DENIED")
        const m = media()
        expect(await code(startCamera(async () => m.stream, () => Promise.reject(new Error("play")), () => false))).toBe("CAMERA_DENIED")
        expect(m.stopped[0]).toBe(true)
    })

    it("hands back the stream, on, when nothing leaves", async () => {
        const m = media()
        await expect(startCamera(async () => m.stream, async () => {}, () => false)).resolves.toBe(m.stream)
        expect(m.stopped[0]).toBe(false)
    })

    it("is what the camera screen starts with, and its refusal reaches the capture", () => {
        const screen = readFileSync("components/FaceCamera.tsx", "utf8")
        expect(screen).toContain("startCamera(")
        expect(screen).toContain("() => gone,")
        expect(screen).toContain("request.failed(error)")
        expect(screen).not.toContain("if (gone) { media.getTracks().forEach(track => track.stop()); return }")
    })
})
