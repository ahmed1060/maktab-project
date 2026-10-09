import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { ringShare, startCamera, startCapture } from "./camera"

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
        expect(screen).toContain("return startCapture({")
        expect(readFileSync("lib/mobile/face-check/camera.ts", "utf8")).toContain("startCamera(ask, play, () => gone)")
        expect(screen).toContain("failed: error => request.failed(error)")
        expect(screen).not.toContain("if (gone) { media.getTracks().forEach(track => track.stop()); return }")
    })
})

describe("a start closed while it waits, and the capture opened after it (Codex review on #49)", () => {
    // Its failure took the screen down for whatever showed: the next capture's camera was stopped and its overlay gone.
    const media = () => {
        const stopped: boolean[] = [false]
        return { stopped, stream: { getTracks: () => [{ stop: () => { stopped[0] = true } }] } as unknown as MediaStream }
    }
    const waiting = <T,>() => { let go!: (v: T) => void; const p = new Promise<T>(r => { go = r }); return { p, go } }
    const settle = () => new Promise(r => setTimeout(r, 0))
    const capture = (told: string[], name: string) => ({
        ready: () => { told.push(`${name} ready`) },
        failed: (e: Error & { code?: string }) => { told.push(`${name} ${e.code}`) },
    })

    for (const at of ["the camera is asked for", "the picture starts"] as const) {
        it(`leaves the next capture alone when closed while ${at}`, async () => {
            const told: string[] = [], undo = vi.fn()
            const first = media(), asked = waiting<MediaStream>(), playing = waiting<void>()
            const close = startCapture(capture(told, "first"),
                () => (at === "the camera is asked for" ? asked.p : Promise.resolve(first.stream)),
                () => (at === "the picture starts" ? playing.p : Promise.resolve()), undo)
            await settle()
            close()
            const second = media()
            startCapture(capture(told, "second"), async () => second.stream, async () => {}, undo)
            await settle()
            asked.go(first.stream)
            playing.go()
            await settle()
            expect(told).toEqual(["second ready", "first FACE_CANCELLED"])
            expect(undo).not.toHaveBeenCalled()
            expect(first.stopped[0]).toBe(true)
            expect(second.stopped[0]).toBe(false)
        })
    }

    it("still takes the screen down for a start that is still the one showing", async () => {
        const told: string[] = [], undo = vi.fn()
        startCapture(capture(told, "only"), () => Promise.reject(new Error("NotAllowedError")), async () => {}, undo)
        await settle()
        expect(told).toEqual(["only CAMERA_DENIED"])
        expect(undo).toHaveBeenCalledTimes(1)
    })

    it("is how the camera screen starts, with the screen undone only through it", () => {
        const effect = readFileSync("components/FaceCamera.tsx", "utf8").split("// Once the overlay is up")[1].split("// Leaving the page mid-capture")[0]
        expect(effect).toContain("() => { stopStream(); setRequest(null); setPrompt(null) })")
        expect(effect).not.toContain(".catch((error: Error)")
    })
})
