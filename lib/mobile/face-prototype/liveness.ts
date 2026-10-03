/**
 * The prototype's liveness check (mobile/README.md, "Free prototype"): an
 * active challenge read from the 68 face landmarks. Turn your head to one
 * side and back, and close your eyes and open them, in an order chosen at
 * random each time, so a photo held up fails and a recorded video has to
 * guess the order.
 *
 * Not certified to anything. A commercial SDK's passive liveness (ISO
 * 30107-3) replaces this before real use.
 *
 * Tuned after the first try on a phone: a quick blink fell between two looks
 * at the camera, fixed eye thresholds didn't suit everyone's eyes, a turn far
 * enough to count often lost the face, and one slow step started the whole
 * check again. Eyes are now judged against the person's own open eyes
 * (`baseline`), the turn asked for is smaller, and a step that runs out of
 * time is tried again on its own, within an overall limit.
 */

export type Point = { x: number; y: number }

/** Landmarks per the 68-point scheme (iBUG 300-W): 30 nose tip, 36–41 one eye, 42–47 the other. */
export type Landmarks = readonly Point[]

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** How open one eye is: about 0.3 open, below 0.2 closed (Soukupová and Čech, 2016). */
export function eyeAspectRatio(eye: readonly Point[]): number {
    const [p1, p2, p3, p4, p5, p6] = eye
    const width = dist(p1, p4)
    return width === 0 ? 0 : (dist(p2, p6) + dist(p3, p5)) / (2 * width)
}

/** Both eyes' openness, averaged. */
export function openness(l: Landmarks): number {
    return (eyeAspectRatio(l.slice(36, 42)) + eyeAspectRatio(l.slice(42, 48))) / 2
}

/**
 * Where the nose tip sits between the outer eye corners, 0 to 1: about 0.5
 * facing the camera, towards 0 or 1 turned to either side.
 */
export function turn(l: Landmarks): number {
    const a = l[36], b = l[45], nose = l[30]
    const span = b.x - a.x
    return span === 0 ? 0.5 : (nose.x - a.x) / span
}

export const LIMITS = {
    /** Facing the camera: the nose within this of the middle. */
    facing: 0.12,
    /** Turned: the nose this far from the middle. Small enough that the face stays in view. */
    turned: 0.15,
    /** Eyes count as open, before the person's own level is known. */
    open: 0.2,
    /** Eyes closed: below this share of the person's own open eyes. */
    closedRatio: 0.7,
    /** Eyes open again, and open enough to face the camera: above this share. */
    openRatio: 0.85,
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

/** One look at the camera: the landmarks of the one face seen, or how many faces there were. */
export type Observation = { faces: number; landmarks: Landmarks | null; at: number }

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
    /** How many times the current step has been started. */
    tries: number
    /** How open this person's eyes are when open, measured before the challenge. */
    baseline: number
    done: boolean
    failed: null | "TIMEOUT" | "FACES"
}

export function startLiveness(order: Challenge[], at: number, baseline: number = LIMITS.open / LIMITS.openRatio): LivenessState {
    return { queue: [...order], completed: [], stage: { kind: "FACING" }, stageStarted: at, started: at, tries: 1, baseline, done: false, failed: null }
}

/** Eyes open enough to count as looking at the camera, for this person (or anyone, without a baseline). */
export function eyesOpen(l: Landmarks, baseline?: number): boolean {
    return openness(l) >= (baseline ? baseline * LIMITS.openRatio : LIMITS.open)
}

/** Whether a frame faces the camera with eyes open: the frames used for matching and the photo. */
export function frontal(l: Landmarks, baseline?: number): boolean {
    return Math.abs(turn(l) - 0.5) <= LIMITS.facing && eyesOpen(l, baseline)
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
    if (o.at - s.stageStarted > LIMITS.stepMs) {
        if (s.tries >= LIMITS.triesPerStep) return { state: { ...s, failed: "TIMEOUT" }, prompt: promptOf(s) }
        // The same step again, from its start: a turn or a blink half done doesn't carry over.
        const state: LivenessState = { ...s, stage: restart(s.stage), stageStarted: o.at, tries: s.tries + 1 }
        return { state, prompt: promptOf(state), cue: "RETRY" }
    }
    // No face this look (turned too far, or out of the light): nothing changes, and it doesn't count against the step.
    if (!o.landmarks) return { state: s, prompt: promptOf(s) }
    const l = o.landmarks
    const offCentre = Math.abs(turn(l) - 0.5)

    switch (s.stage.kind) {
        case "FACING": {
            if (!frontal(l, s.baseline)) return { state: s, prompt: "FACE_CAMERA" }
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
            const eyes = openness(l)
            if (!s.stage.closed) {
                if (eyes <= s.baseline * LIMITS.closedRatio) return { state: { ...s, stage: { kind: "BLINK", closed: true } }, prompt: "OPEN_EYES", cue: "HALF" }
                return { state: s, prompt: "BLINK" }
            }
            if (eyes >= s.baseline * LIMITS.openRatio) return completeStep(s, o.at)
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
    /** How open the eyes are, as a share of the person's own open eyes; null with no face. */
    eyes: number | null
}

export function progressOf(s: LivenessState, o: Observation, order: readonly Challenge[]): Progress {
    const current = s.done || s.stage.kind === "FACING" ? null : s.queue[0] ?? null
    const l = o.landmarks
    return {
        steps: order.map(challenge => ({ challenge, done: s.completed.includes(challenge), current: challenge === current })),
        timeLeft: Math.max(0, Math.min(1, 1 - (o.at - s.stageStarted) / LIMITS.stepMs)),
        turnAmount: l ? Math.max(-1, Math.min(1, (turn(l) - 0.5) / LIMITS.turned)) : null,
        eyes: l ? openness(l) / s.baseline : null,
    }
}

/** The person's own open-eye level, from a few looks straight at the camera: the middle one, so one squint doesn't set it. */
export function baselineOf(readings: readonly number[]): number {
    const sorted = [...readings].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? LIMITS.open / LIMITS.openRatio
}
