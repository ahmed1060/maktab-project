import { baselineOf, challenges, frontal, openness, progressOf, startLiveness, step, turn, LIMITS } from "./liveness"
import { oneFace, type Descriptor } from "./match"
import { look } from "./engine"
import { snapshot, type Camera } from "./camera"

type FaceApi = typeof import("@vladmandic/face-api")

export type Captured = {
    /** Liveness passed. */
    live: boolean
    /** The face looking at the camera before and after the challenge: the same face, or empty. */
    descriptors: Descriptor[]
    /** A photo facing the camera, for the person who approves it. */
    photo: string | null
    /** The last frame seen, for a failed check's review. */
    frame: string | null
}

/** Looks straight at the camera that set the person's own open-eye level. */
const BASELINE_LOOKS = 5
/** Eyes this shut aren't a baseline: someone squinting or mid-blink at the start. */
const BASELINE_MIN = 0.12

/**
 * Lets the screen draw between looks without a fixed pause: a blink is over in
 * a few hundred milliseconds, and a pause of its own made most of them fall
 * between two looks.
 */
const nextFrame = () => new Promise<void>(r => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => r()) : setTimeout(r, 0)))

/**
 * One capture: a frontal look (the photo, the first descriptor, and the
 * person's own open-eye level), the liveness challenge, and another frontal
 * look. Both looks must be of the same face, so the challenge can't be done
 * by one person and the match by another. Stops when the person closes the
 * camera.
 */
export async function capture(api: FaceApi, camera: Camera, random: () => number = Math.random): Promise<Captured> {
    let stop = false
    const cancelled = camera.cancelled.catch(e => { stop = true; throw e })
    const run = async (): Promise<Captured> => {
        const descriptors: Descriptor[] = []
        let photo: string | null = null
        let frame: string | null = null
        const readings: number[] = []
        // Looking straight at the camera first: the photo and descriptor from the first good look, the eye level from a few.
        while (!stop && readings.length < BASELINE_LOOKS) {
            const l = await look(api, camera.video, descriptors.length === 0)
            if (l.faces > 1) camera.say("ONE_FACE")
            // Facing the camera with eyes not shut; how open is this person's own measure, not a fixed one.
            else if (l.landmarks && Math.abs(turn(l.landmarks) - 0.5) <= LIMITS.facing && openness(l.landmarks) >= BASELINE_MIN
                && (descriptors.length > 0 || l.descriptor)) {
                if (descriptors.length === 0) {
                    descriptors.push(l.descriptor!)
                    photo = snapshot(camera.video)
                }
                readings.push(openness(l.landmarks))
                camera.say("HOLD_STILL")
            } else camera.say("FACE_CAMERA")
            await nextFrame()
        }
        const baseline = baselineOf(readings)
        const order = challenges(random)
        let state = startLiveness(order, Date.now(), baseline)
        while (!stop && !state.done && !state.failed) {
            const l = await look(api, camera.video, false)
            const o = { faces: l.faces, landmarks: l.landmarks, at: Date.now() }
            const r = step(state, o)
            state = r.state
            camera.say(r.prompt)
            camera.show?.(progressOf(state, o, order))
            if (r.cue) camera.cue?.(r.cue)
            await nextFrame()
        }
        frame = snapshot(camera.video)
        if (!state.done) return { live: false, descriptors: [], photo, frame }
        // And a frontal look after, which must be the same face.
        camera.say("WORKING")
        const deadline = Date.now() + 5000
        while (!stop && Date.now() < deadline) {
            const l = await look(api, camera.video, true)
            if (l.landmarks && l.descriptor && frontal(l.landmarks, baseline)) {
                descriptors.push(l.descriptor)
                frame = snapshot(camera.video)
                break
            }
            camera.say("FACE_CAMERA")
            await nextFrame()
        }
        if (descriptors.length < 2 || !oneFace(descriptors)) return { live: false, descriptors: [], photo, frame }
        return { live: true, descriptors, photo, frame }
    }
    return Promise.race([run(), cancelled])
}

