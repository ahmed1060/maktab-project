import { baselineOf, challenges, frontal, progressOf, startLiveness, step, LIMITS } from "./liveness"
import { oneFace } from "./match"
import { grab, type Engine } from "./engine"
import { snapshot, type Camera } from "./camera"
import type { Template } from "./vault"

export type Captured = {
    /** The challenge passed, and the face was the same before and after it. */
    live: boolean
    /** The face looking at the camera before and after the challenge: the same face, or empty. */
    templates: Template[]
    /** The anti-spoofing's score, the lower of the two looks' (0 to 1); null when it never saw the face. */
    real: number | null
    /** A photo facing the camera, for the person who approves it. */
    photo: string | null
    /** The last frame seen, for a failed check's review. */
    frame: string | null
}

/** Looks straight at the camera that set the person's own open-eye level. */
const BASELINE_LOOKS = 5
/** Eyes more closed than this aren't a baseline: someone squinting or mid-blink at the start. */
const BASELINE_MAX = 0.4
/** How long the look at the camera after the challenge may take. */
const LAST_LOOK_MS = 5000

const now = () => performance.now()

/**
 * Lets the screen draw between looks without a fixed pause: a blink is over in
 * a few hundred milliseconds, and a pause of its own made most of them fall
 * between two looks.
 */
const nextFrame = () => new Promise<void>(r => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => r()) : setTimeout(r, 0)))

/**
 * One capture: a frontal look (the photo, the first template, and the
 * person's own open-eye level), the liveness challenge, and another frontal
 * look. Both looks must be of the same face, so the challenge can't be done
 * by one person and the match by another. Stops when the person closes the
 * camera.
 *
 * The challenge runs on MediaPipe's readings, many a second; the slower
 * recognition and anti-spoofing only on the two frontal looks.
 */
export async function capture(engine: Engine, camera: Camera, random: () => number = Math.random): Promise<Captured> {
    let stop = false
    const cancelled = camera.cancelled.catch(e => { stop = true; throw e })
    const run = async (): Promise<Captured> => {
        const templates: Template[] = []
        const real: number[] = []
        let photo: string | null = null
        let frame: string | null = null
        const readings: number[] = []
        const result = (live: boolean): Captured => ({
            live, templates: live ? templates : [], real: real.length ? Math.min(...real) : null, photo, frame,
        })
        /** Who is in front of the camera now: the template, or why there is none. */
        const identify = async (): Promise<"ONE" | "NONE" | "MANY"> => {
            const pixels = grab(camera.video)
            // The photo of the very frame matched, not one taken after the person has moved.
            const shot = snapshot(camera.video)
            const id = await engine.identify(pixels)
            // The frame looked at, whatever was found: a check that fails here is reviewed on it (review on #47).
            frame = shot
            if (id.faces > 1) return "MANY"
            if (!id.embedding) return "NONE"
            templates.push(id.embedding)
            if (id.live !== null) real.push(id.live)
            if (!photo) photo = shot
            return "ONE"
        }
        // A new attempt starts with nothing ticked: the last attempt's steps and timer would mislead (review on #30).
        camera.show?.(null)
        // Looking straight at the camera first: the photo and template from the first good look, the eye level from a few.
        while (!stop && readings.length < BASELINE_LOOKS) {
            const l = engine.read(camera.video, now())
            if (l.faces > 1) camera.say("ONE_FACE")
            // Facing the camera with eyes not shut; how open is this person's own measure, not a fixed one.
            else if (l.reading && Math.abs(l.reading.turn - 0.5) <= LIMITS.facing && l.reading.eyes <= BASELINE_MAX) {
                if (templates.length === 0) {
                    camera.say("HOLD_STILL")
                    const found = await identify()
                    if (found !== "ONE") {
                        camera.say(found === "MANY" ? "ONE_FACE" : "FACE_CAMERA")
                        await nextFrame()
                        continue
                    }
                }
                readings.push(l.reading.eyes)
                camera.say("HOLD_STILL")
            } else camera.say("FACE_CAMERA")
            await nextFrame()
        }
        const baseline = baselineOf(readings)
        const order = challenges(random)
        let state = startLiveness(order, now(), baseline)
        while (!stop && !state.done && !state.failed) {
            const l = engine.read(camera.video, now())
            const o = { faces: l.faces, reading: l.reading, at: now() }
            const r = step(state, o)
            state = r.state
            camera.say(r.prompt)
            camera.show?.(progressOf(state, o, order))
            if (r.cue) camera.cue?.(r.cue)
            await nextFrame()
        }
        if (!state.done) {
            frame = snapshot(camera.video)
            return result(false)
        }
        // And a frontal look after, which must be the same face.
        camera.say("WORKING")
        const deadline = now() + LAST_LOOK_MS
        while (!stop && now() < deadline) {
            const l = engine.read(camera.video, now())
            if (l.faces === 1 && l.reading && frontal(l.reading, baseline)) {
                const found = await identify()
                if (found === "ONE") break
                if (found === "MANY") return result(false)
            }
            camera.say("FACE_CAMERA")
            await nextFrame()
        }
        if (templates.length < 2) {
            frame = snapshot(camera.video)
            return result(false)
        }
        return result(oneFace(templates))
    }
    return Promise.race([run(), cancelled])
}
