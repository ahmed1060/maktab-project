import { challenges, frontal, startLiveness, step } from "./liveness"
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

const TICK_MS = 120
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * One capture: a frontal look, the liveness challenge, and another frontal
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
        // A frontal look first: the photo and the first descriptor.
        while (!stop && descriptors.length === 0) {
            const l = await look(api, camera.video, true)
            if (l.faces > 1) camera.say("ONE_FACE")
            else if (l.landmarks && l.descriptor && frontal(l.landmarks)) {
                descriptors.push(l.descriptor)
                photo = snapshot(camera.video)
            } else camera.say("FACE_CAMERA")
            await sleep(TICK_MS)
        }
        let state = startLiveness(challenges(random), Date.now())
        while (!stop && !state.done && !state.failed) {
            const l = await look(api, camera.video, false)
            const r = step(state, { faces: l.faces, landmarks: l.landmarks, at: Date.now() })
            state = r.state
            camera.say(r.prompt)
            await sleep(TICK_MS)
        }
        frame = snapshot(camera.video)
        if (!state.done) return { live: false, descriptors: [], photo, frame }
        // And a frontal look after, which must be the same face.
        camera.say("WORKING")
        const deadline = Date.now() + 5000
        while (!stop && Date.now() < deadline) {
            const l = await look(api, camera.video, true)
            if (l.landmarks && l.descriptor && frontal(l.landmarks)) {
                descriptors.push(l.descriptor)
                frame = snapshot(camera.video)
                break
            }
            camera.say("FACE_CAMERA")
            await sleep(TICK_MS)
        }
        if (descriptors.length < 2 || !oneFace(descriptors)) return { live: false, descriptors: [], photo, frame }
        return { live: true, descriptors, photo, frame }
    }
    return Promise.race([run(), cancelled])
}
