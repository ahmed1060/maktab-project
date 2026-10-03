/**
 * The prototype's liveness check (mobile/README.md, "Free prototype"): an
 * active challenge read from the 68 face landmarks. Turn your head to one
 * side and back, and blink, in an order chosen at random each time, so a
 * photo held up fails and a recorded video has to guess the order.
 *
 * Not certified to anything. A commercial SDK's passive liveness (ISO
 * 30107-3) replaces this before real use.
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
    /** Turned: the nose this far from the middle. */
    turned: 0.2,
    /** Eyes open above, closed below. */
    open: 0.25,
    closed: 0.19,
    /** Each step must be done within this. */
    stepMs: 7000,
}

export type Challenge = "TURN" | "BLINK"
export type Prompt = "FACE_CAMERA" | "TURN_HEAD" | "LOOK_BACK" | "BLINK" | "HOLD_STILL" | "ONE_FACE"

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
    queue: Challenge[]
    stage: Stage
    stageStarted: number
    done: boolean
    failed: null | "TIMEOUT" | "FACES"
}

export function startLiveness(order: Challenge[], at: number): LivenessState {
    return { queue: [...order], stage: { kind: "FACING" }, stageStarted: at, done: false, failed: null }
}

/**
 * The next state after one observation, and what to tell the person. A
 * second face at any point fails it: someone else can't stand in for part
 * of it. Each step has a time limit.
 */
export function step(s: LivenessState, o: Observation): { state: LivenessState; prompt: Prompt } {
    if (s.done || s.failed) return { state: s, prompt: "HOLD_STILL" }
    if (o.faces > 1) return { state: { ...s, failed: "FACES" }, prompt: "ONE_FACE" }
    if (o.at - s.stageStarted > LIMITS.stepMs) return { state: { ...s, failed: "TIMEOUT" }, prompt: promptOf(s) }
    if (!o.landmarks) return { state: s, prompt: s.stage.kind === "FACING" ? "FACE_CAMERA" : promptOf(s) }
    const l = o.landmarks
    const offCentre = Math.abs(turn(l) - 0.5)
    const next = (stage: Stage, queue = s.queue): LivenessState => ({ ...s, stage, queue, stageStarted: o.at })

    switch (s.stage.kind) {
        case "FACING": {
            if (offCentre > LIMITS.facing || openness(l) < LIMITS.open) return { state: s, prompt: "FACE_CAMERA" }
            const [first, ...rest] = s.queue
            if (!first) return { state: { ...s, done: true }, prompt: "HOLD_STILL" }
            const state = next(first === "TURN" ? { kind: "TURN", turned: false } : { kind: "BLINK", closed: false }, rest)
            return { state, prompt: promptOf(state) }
        }
        case "TURN": {
            if (!s.stage.turned) {
                if (offCentre >= LIMITS.turned) {
                    const state: LivenessState = { ...s, stage: { kind: "TURN", turned: true } }
                    return { state, prompt: "LOOK_BACK" }
                }
                return { state: s, prompt: "TURN_HEAD" }
            }
            if (offCentre <= LIMITS.facing) return after(s, o.at)
            return { state: s, prompt: "LOOK_BACK" }
        }
        case "BLINK": {
            const eyes = openness(l)
            if (!s.stage.closed) {
                if (eyes <= LIMITS.closed) return { state: { ...s, stage: { kind: "BLINK", closed: true } }, prompt: "BLINK" }
                return { state: s, prompt: "BLINK" }
            }
            if (eyes >= LIMITS.open) return after(s, o.at)
            return { state: s, prompt: "BLINK" }
        }
    }
}

/** A challenge done: the next one, or done when none is left. */
function after(s: LivenessState, at: number): { state: LivenessState; prompt: Prompt } {
    if (s.queue.length === 0) return { state: { ...s, done: true }, prompt: "HOLD_STILL" }
    return { state: { ...s, stage: { kind: "FACING" }, stageStarted: at }, prompt: "FACE_CAMERA" }
}

function promptOf(s: LivenessState): Prompt {
    if (s.stage.kind === "TURN") return s.stage.turned ? "LOOK_BACK" : "TURN_HEAD"
    if (s.stage.kind === "BLINK") return "BLINK"
    return "FACE_CAMERA"
}

/** Whether a frame faces the camera with eyes open: the frames used for matching and the photo. */
export function frontal(l: Landmarks): boolean {
    return Math.abs(turn(l) - 0.5) <= LIMITS.facing && openness(l) >= LIMITS.open
}
