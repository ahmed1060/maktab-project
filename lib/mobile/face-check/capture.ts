import { baselineOf, challenges, frontal, progressOf, startLiveness, step, LIMITS, type Box, type Challenge, type Reading } from "./liveness"
import { oneFace } from "./match"
import { cosine } from "./models"
import { grab, type Engine } from "./engine"
import { snapshot, type Camera, type FitPrompt } from "./camera"
import type { Template } from "./vault"

export type Captured = {
    /** Live, as far as the check can tell: the same face throughout, and the step passed when one was asked for. */
    live: boolean
    /** The face's looks during the capture: the same face, or empty. */
    templates: Template[]
    /** The anti-spoofing's score, the lowest of the looks' (0 to 1); null when it never saw the face. */
    real: number | null
    /** A photo facing the camera, for the person who approves it. */
    photo: string | null
    /** The last frame seen, for a failed check's review. */
    frame: string | null
    /** Whether the check had doubts and asked for a step (a turn or a blink). */
    challenged: boolean
}

export type CaptureOptions = {
    /** Ask for the step whatever the looks say: a second attempt, after one that didn't pass. */
    challenge?: boolean
    random?: () => number
}

/** The face in the oval: about a third to three quarters of the picture's width, its middle near the oval's. */
export const FIT = { minWidth: 0.28, maxWidth: 0.75, centreX: [0.3, 0.7], centreY: [0.25, 0.65] } as const
/** In the oval, facing the camera, this long before the first look is taken... */
export const STEADY_MS = 500
/** ...and the second this long after it: two looks, so one frame can't stand in for a face. */
export const LOOK_GAP_MS = 600
/** The capture gives up when the face hasn't settled in the oval within this. */
export const FIT_MS = 20_000
/** Eyes more closed than this don't count as looking at the camera. */
const EYES_OPEN_MAX = 0.4
/** How long the look at the camera after a step may take. */
const LAST_LOOK_MS = 5000
/** The tick on screen this long before the camera closes: done, seen. */
const DONE_MS = 450

/**
 * When the check is sure: the anti-spoofing at least this sure it's a live face,
 * and the two looks at least this alike. Below either, it asks for a step. The
 * same person 0.6 s apart reads 0.85 or more; two different people below 0.25.
 */
export const SURE = { live: 0.8, same: 0.75 } as const
/** Two looks less alike than this are two faces: the capture fails, it doesn't ask for a step. */
const SAME_FACE = 0.5

const now = () => performance.now()

/**
 * Lets the screen draw between looks without a fixed pause: a blink is over in
 * a few hundred milliseconds, and a pause of its own made most of them fall
 * between two looks.
 */
const nextFrame = () => new Promise<void>(r => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => r()) : setTimeout(r, 0)))

/** The whole picture: where nothing is cropped. */
const WHOLE: Box = { x: 0, y: 0, w: 1, h: 1 }

/** What's wrong with the face's place in the oval, as it appears in the `view` the person sees, or null when it fits. */
export function fitOf(face: Box | undefined, view: Box = WHOLE): FitPrompt | null {
    if (!face) return null
    const box = { x: (face.x - view.x) / view.w, y: (face.y - view.y) / view.h, w: face.w / view.w, h: face.h / view.h }
    if (box.w < FIT.minWidth) return "CLOSER"
    if (box.w > FIT.maxWidth) return "FARTHER"
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2
    if (cx < FIT.centreX[0] || cx > FIT.centreX[1] || cy < FIT.centreY[0] || cy > FIT.centreY[1]) return "CENTER"
    return null
}

/** Whether the check has doubts about these looks, and so asks for a step. */
export function doubtful(real: readonly number[], templates: readonly Template[], forced: boolean): boolean {
    if (forced) return true
    if (real.length === 0 || Math.min(...real) < SURE.live) return true
    for (let i = 1; i < templates.length; i++) if (cosine(templates[0], templates[i]) < SURE.same) return true
    return false
}

type Found = "ONE" | "NONE" | "MANY"

/**
 * One capture, passive first, as the phone face checks people know do it: the
 * face fitted in the oval and held there a moment, two looks taken on their own,
 * recognised in the background while the ring fills. Only when the check has
 * doubts (the anti-spoofing unsure, the looks not clearly alike, or a second
 * attempt) does it ask for one step, a turn or a blink chosen at random, and
 * then a last look that must be the same face. Stops when the person closes
 * the camera.
 */
export async function capture(engine: Engine, camera: Camera, options: CaptureOptions = {}): Promise<Captured> {
    const random = options.random ?? Math.random
    let stop = false
    const cancelled = camera.cancelled.catch(e => { stop = true; throw e })
    const run = async (): Promise<Captured> => {
        const templates: Template[] = []
        const real: number[] = []
        let photo: string | null = null
        let frame: string | null = null
        let challenged = false
        const eyes: number[] = []
        const result = (live: boolean): Captured => ({
            live, templates: live ? templates : [], real: real.length ? Math.min(...real) : null, photo, frame, challenged,
        })
        /** Who is in front of the camera now: the template, or why there is none. */
        const identify = async (): Promise<Found> => {
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
        const looking = (r: Reading | null, faces: number): r is Reading =>
            faces === 1 && !!r && Math.abs(r.turn - 0.5) <= LIMITS.facing && r.eyes <= EYES_OPEN_MAX

        // A new attempt starts with nothing ticked: the last attempt's steps and timer would mislead (review on #30).
        camera.show?.(null)
        camera.fill?.(0)
        const started = now()
        // The looks taken so far, each recognised in the background as soon as it is taken.
        let looks: Promise<Found>[] = []
        let steadySince: number | null = null
        let lastLook = 0
        for (;;) {
            if (stop) return result(false)
            if (now() - started > FIT_MS) {
                frame = snapshot(camera.video)
                return result(false)
            }
            const l = engine.read(camera.video, now())
            // Upright first: on its side, the oval on the screen isn't the one the fit measures against.
            const misfit = camera.upright && !camera.upright() ? "UPRIGHT"
                : l.faces === 1 && l.reading ? fitOf(l.reading.box, camera.visible?.()) : null
            if (misfit === "UPRIGHT" || l.faces > 1 || !looking(l.reading, l.faces) || misfit) {
                camera.say(misfit === "UPRIGHT" ? misfit : l.faces > 1 ? "ONE_FACE" : !looking(l.reading, l.faces) ? "FACE_CAMERA" : misfit!)
                // Out of place: the look under way starts again; the ring keeps the looks already taken.
                steadySince = null
                camera.fill?.(looks.length / 2)
                await nextFrame()
                continue
            }
            camera.say("HOLD_STILL")
            eyes.push(l.reading.eyes)
            const t = now()
            steadySince ??= t
            const span = looks.length === 0 ? STEADY_MS : LOOK_GAP_MS
            const from = looks.length === 0 ? steadySince : Math.max(steadySince, lastLook)
            camera.fill?.((looks.length + Math.min(1, (t - from) / span)) / 2)
            if (t - from >= span) {
                looks.push(identify())
                lastLook = t
                if (looks.length === 2) {
                    camera.say("WORKING")
                    const found = await Promise.all(looks)
                    if (found.includes("MANY")) return result(false)
                    if (!found.includes("NONE")) break
                    // A look that found no face: taken again, keeping the one that did.
                    looks = found.filter(f => f === "ONE").map(f => Promise.resolve(f))
                    steadySince = null
                    camera.fill?.(looks.length / 2)
                }
            }
            await nextFrame()
        }
        // Two looks of two different faces: someone else stood in.
        if (cosine(templates[0], templates[1]) < SAME_FACE) return result(false)

        if (doubtful(real, templates, !!options.challenge)) {
            challenged = true
            camera.fill?.(null)
            camera.say("EXTRA")
            const baseline = baselineOf(eyes.slice(-10))
            const order: Challenge[] = [challenges(random)[0]]
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
            camera.show?.(null)
            if (!state.done) {
                frame = snapshot(camera.video)
                return result(false)
            }
            // And a frontal look after, which must be the same face.
            camera.say("WORKING")
            const deadline = now() + LAST_LOOK_MS
            let last: Found = "NONE"
            while (!stop && now() < deadline) {
                const l = engine.read(camera.video, now())
                if (l.faces === 1 && l.reading && frontal(l.reading, baseline)) {
                    last = await identify()
                    if (last !== "NONE") break
                }
                camera.say("FACE_CAMERA")
                await nextFrame()
            }
            if (last !== "ONE") {
                frame = snapshot(camera.video)
                return result(false)
            }
        }
        if (!oneFace(templates)) return result(false)
        camera.fill?.(1)
        camera.say("DONE")
        camera.cue?.("STEP")
        await new Promise(r => setTimeout(r, DONE_MS))
        return result(true)
    }
    return Promise.race([run(), cancelled])
}
