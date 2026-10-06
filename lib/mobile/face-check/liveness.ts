/**
 * The face check's liveness challenge: turn your head to one side and back,
 * and close your eyes and open them, in an order chosen at random each time,
 * so a photo held up fails and a recorded video has to guess the order.
 *
 * Read from MediaPipe's Face Landmarker (lib/mobile/face-check/engine.ts):
 * how closed the eyes are comes straight from its eyeBlinkLeft/Right scores,
 * which it estimates for the whole eye region. The prototype before it
 * worked the same thing out from six dlib points around each eye, which
 * hardly moved when the eyelids closed, so a blink was often never seen.
 *
 * The flow is the prototype's, as tuned on a phone: eyes judged against the
 * person's own open eyes (`baseline`), a modest turn, a step that runs out of
 * time tried again on its own within an overall limit, and time with no face
 * in view left off the step's clock.
 *
 * Not certified to anything: a commercial SDK's liveness replaces it before
 * release (mobile/FACE_CHECK.md).
 */

/**
 * One look at the face, reduced to what the challenge needs.
 * - eyes: how closed, 0 open to 1 shut (both eyes' blink scores, averaged);
 * - turn: where the nose tip sits between the outer eye corners, 0 to 1:
 *   about 0.5 facing the camera, towards 0 or 1 turned to either side.
 */
export type Reading = { eyes: number; turn: number; box?: Box }

/** Where the face is in the picture, as shares of its width and height (0 to 1), as the camera sees it, unmirrored. */
export type Box = { x: number; y: number; w: number; h: number }

export const LIMITS = {
    /** Facing the camera: the nose within this of the middle. */
    facing: 0.12,
    /** Turned: the nose this far from the middle. Small enough that the face stays in view. */
    turned: 0.15,
    /** Eyes count as closed at this much more than the person's own open level... */
    closedAbove: 0.3,
    /** ...and never below this, however open their eyes usually are. */
    closedAtLeast: 0.45,
    /** Open again, and open enough to face the camera: within this of their open level. */
    openWithin: 0.15,
    /** Before the person's own level is known. */
    openDefault: 0.1,
    /** A step is tried again when it takes longer than this... */
    stepMs: 8000,
    /** ...up to this many times... */
    triesPerStep: 3,
    /** ...and the whole challenge must be done within this. */
    totalMs: 45000,
}

export type Challenge = "TURN" | "BLINK"
export type Prompt = "FACE_CAMERA" | "TURN_HEAD" | "LOOK_BACK" | "BLINK" | "OPEN_EYES" | "HOLD_STILL" | "ONE_FACE"
/** Something to tell the person beyond the words: a step half or wholly done, or tried again. */
export type Cue = "HALF" | "STEP" | "RETRY"

/** The order of the two challenges, chosen at random. */
export function challenges(random: () => number = Math.random): Challenge[] {
    return random() < 0.5 ? ["TURN", "BLINK"] : ["BLINK", "TURN"]
}

/** One look at the camera: the reading of the one face seen, or how many faces there were. */
export type Observation = { faces: number; reading: Reading | null; at: number }

type Stage =
    | { kind: "FACING" }
    | { kind: "TURN"; turned: boolean }
    | { kind: "BLINK"; closed: boolean }

export type LivenessState = {
    /** The challenges still to do; the first is the one under way, or next. */
    queue: Challenge[]
    completed: Challenge[]
    stage: Stage
    stageStarted: number
    started: number
    /** When the last look came, so time with no face seen can be left off the step's clock. */
    lastAt: number
    /** How many times the current step has been started. */
    tries: number
    /** How closed this person's eyes read when open, measured before the challenge. */
    baseline: number
    done: boolean
    failed: null | "TIMEOUT" | "FACES"
}

export function startLiveness(order: Challenge[], at: number, baseline: number = LIMITS.openDefault): LivenessState {
    return { queue: [...order], completed: [], stage: { kind: "FACING" }, stageStarted: at, started: at, lastAt: at, tries: 1, baseline, done: false, failed: null }
}

/** Eyes this closed count as shut, for this person. */
export const closedAt = (baseline: number) => Math.max(LIMITS.closedAtLeast, baseline + LIMITS.closedAbove)
/** Eyes this open count as open again, for this person. */
export const openAt = (baseline: number) => baseline + LIMITS.openWithin

/** Eyes open enough to count as looking at the camera, for this person (or anyone, without a baseline). */
export function eyesOpen(r: Reading, baseline: number = LIMITS.openDefault): boolean {
    return r.eyes <= openAt(baseline)
}

/** Whether a frame faces the camera with eyes open: the frames used for matching and the photo. */
export function frontal(r: Reading, baseline?: number): boolean {
    return Math.abs(r.turn - 0.5) <= LIMITS.facing && eyesOpen(r, baseline)
}

/**
 * The next state after one observation, what to tell the person, and any cue
 * to give. A second face at any point fails it: someone else can't stand in
 * for part of it. A step that takes too long starts again, up to
 * `triesPerStep` times; the whole challenge has `totalMs`.
 */
export function step(s: LivenessState, o: Observation): { state: LivenessState; prompt: Prompt; cue?: Cue } {
    if (s.done || s.failed) return { state: s, prompt: "HOLD_STILL" }
    if (o.faces > 1) return { state: { ...s, failed: "FACES" }, prompt: "ONE_FACE" }
    if (o.at - s.started > LIMITS.totalMs) return { state: { ...s, failed: "TIMEOUT" }, prompt: promptOf(s) }
    // No face this look (turned too far, or out of the light): nothing changes, and the time since the last
    // look is left off the step's clock, so it can't use up the step's tries; the overall limit still runs.
    if (!o.reading) return { state: { ...s, stageStarted: s.stageStarted + (o.at - s.lastAt), lastAt: o.at }, prompt: promptOf(s) }
    s = { ...s, lastAt: o.at }
    if (o.at - s.stageStarted > LIMITS.stepMs) {
        if (s.tries >= LIMITS.triesPerStep) return { state: { ...s, failed: "TIMEOUT" }, prompt: promptOf(s) }
        // The same step again, from its start: a turn or a blink half done doesn't carry over.
        const state: LivenessState = { ...s, stage: restart(s.stage), stageStarted: o.at, tries: s.tries + 1 }
        return { state, prompt: promptOf(state), cue: "RETRY" }
    }
    const r = o.reading
    const offCentre = Math.abs(r.turn - 0.5)

    switch (s.stage.kind) {
        case "FACING": {
            if (!frontal(r, s.baseline)) return { state: s, prompt: "FACE_CAMERA" }
            const [first] = s.queue
            if (!first) return { state: { ...s, done: true }, prompt: "HOLD_STILL" }
            const state: LivenessState = { ...s, stage: first === "TURN" ? { kind: "TURN", turned: false } : { kind: "BLINK", closed: false }, stageStarted: o.at, tries: 1 }
            return { state, prompt: promptOf(state) }
        }
        case "TURN": {
            if (!s.stage.turned) {
                if (offCentre >= LIMITS.turned) return { state: { ...s, stage: { kind: "TURN", turned: true } }, prompt: "LOOK_BACK", cue: "HALF" }
                return { state: s, prompt: "TURN_HEAD" }
            }
            if (offCentre <= LIMITS.facing) return completeStep(s, o.at)
            return { state: s, prompt: "LOOK_BACK" }
        }
        case "BLINK": {
            if (!s.stage.closed) {
                if (r.eyes >= closedAt(s.baseline)) return { state: { ...s, stage: { kind: "BLINK", closed: true } }, prompt: "OPEN_EYES", cue: "HALF" }
                return { state: s, prompt: "BLINK" }
            }
            if (r.eyes <= openAt(s.baseline)) return completeStep(s, o.at)
            return { state: s, prompt: "OPEN_EYES" }
        }
    }
}

function restart(stage: Stage): Stage {
    if (stage.kind === "TURN") return { kind: "TURN", turned: false }
    if (stage.kind === "BLINK") return { kind: "BLINK", closed: false }
    return stage
}

/** A challenge done: the next one, or done when none is left. */
function completeStep(s: LivenessState, at: number): { state: LivenessState; prompt: Prompt; cue: Cue } {
    const [doneNow, ...rest] = s.queue
    const completed = [...s.completed, doneNow]
    if (rest.length === 0) return { state: { ...s, queue: rest, completed, done: true }, prompt: "HOLD_STILL", cue: "STEP" }
    return { state: { ...s, queue: rest, completed, stage: { kind: "FACING" }, stageStarted: at, tries: 1 }, prompt: "FACE_CAMERA", cue: "STEP" }
}

function promptOf(s: LivenessState): Prompt {
    if (s.stage.kind === "TURN") return s.stage.turned ? "LOOK_BACK" : "TURN_HEAD"
    if (s.stage.kind === "BLINK") return s.stage.closed ? "OPEN_EYES" : "BLINK"
    return "FACE_CAMERA"
}

/** What the camera screen shows besides the words: the steps, the time left on this one, and the live readings. */
export type Progress = {
    steps: { challenge: Challenge; done: boolean; current: boolean }[]
    /** 1 when the step has just started, 0 when its time is up. */
    timeLeft: number
    /** How far the head is turned, -1 to 1, where ±1 is enough for the turn step; null with no face. */
    turnAmount: number | null
    /** How closed the eyes are, 0 to 1, where 1 is enough for the blink step; null with no face. */
    eyes: number | null
}

export function progressOf(s: LivenessState, o: Observation, order: readonly Challenge[]): Progress {
    const current = s.done || s.stage.kind === "FACING" ? null : s.queue[0] ?? null
    const r = o.reading
    return {
        steps: order.map(challenge => ({ challenge, done: s.completed.includes(challenge), current: challenge === current })),
        timeLeft: Math.max(0, Math.min(1, 1 - (o.at - s.stageStarted) / LIMITS.stepMs)),
        turnAmount: r ? Math.max(-1, Math.min(1, (r.turn - 0.5) / LIMITS.turned)) : null,
        eyes: r ? Math.max(0, Math.min(1, r.eyes / closedAt(s.baseline))) : null,
    }
}

/** The person's own open-eye level, from a few looks straight at the camera: the middle one, so one squint doesn't set it. */
export function baselineOf(readings: readonly number[]): number {
    const sorted = [...readings].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? LIMITS.openDefault
}
