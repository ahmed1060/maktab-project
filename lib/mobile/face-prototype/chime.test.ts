import { describe, it, expect } from "vitest"
import { chime } from "./chime"

/**
 * Review on #30: the beep was set up when the camera opened, after the app's
 * own fetching, by which time the browser no longer counts it as coming from
 * the tap, and on an iPhone it stayed silent. It is started by the tap now.
 */

/** An AudioContext that, like a browser's, starts suspended and only runs once resumed. */
function fakeAudio() {
    const made: FakeCtx[] = []
    class FakeCtx {
        state: "suspended" | "running" = "suspended"
        tones = 0
        currentTime = 0
        destination = {}
        constructor() { made.push(this) }
        resume() { this.state = "running"; return Promise.resolve() }
        createOscillator() { this.tones++; return { frequency: { value: 0 }, connect() {}, start() {}, stop() {} } }
        createGain() { return { gain: { value: 0 }, connect() {} } }
    }
    return { made, Ctor: FakeCtx as unknown as new () => AudioContext }
}

describe("the face check's beep", () => {
    it("is silent until a tap has started the audio, then sounds", () => {
        const audio = fakeAudio()
        const sound = chime(() => audio.Ctor)
        sound.play(880, 100)
        expect(audio.made).toHaveLength(0)
        sound.unlock()
        sound.play(880, 100)
        expect(audio.made).toHaveLength(1)
        expect((audio.made[0] as unknown as { tones: number }).tones).toBe(1)
    })

    it("keeps one audio context however many taps there are", () => {
        const audio = fakeAudio()
        const sound = chime(() => audio.Ctor)
        sound.unlock(); sound.unlock(); sound.unlock()
        expect(audio.made).toHaveLength(1)
    })

    it("does nothing where there is no audio", () => {
        const sound = chime(() => undefined)
        expect(() => { sound.unlock(); sound.play(440, 50) }).not.toThrow()
    })
})
