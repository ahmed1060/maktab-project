/**
 * The face check for testing (lib/mobile/face-check) is for trying the
 * flow out, never for real employees: its liveness is uncertified. Every
 * enrolment and check it makes names a model starting with this, and the
 * server takes them only where FACE_ALLOW_PROTOTYPE=1 (a test deployment).
 */
export const PROTOTYPE_MODEL_PREFIX = "prototype-"

export function isPrototypeModel(modelVersion: string | null | undefined): boolean {
    return !!modelVersion?.startsWith(PROTOTYPE_MODEL_PREFIX)
}

export function prototypeAllowed(env: Record<string, string | undefined> = process.env): boolean {
    return env.FACE_ALLOW_PROTOTYPE === "1"
}
