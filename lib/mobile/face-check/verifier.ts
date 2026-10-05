import type { FaceVerifier } from "@/lib/mobile/face"
import { loadEngine, type Engine } from "./engine"
import { capture } from "./capture"
import { matches } from "./match"
import { LIVE_SCORE } from "./antispoof"
import { indexedDbStore, Vault, type Store } from "./vault"
import type { Camera, OpenCamera } from "./camera"
import { PROTOTYPE_MODEL_PREFIX } from "@/lib/attendance/face-prototype-gate"

/**
 * The face check for testing (mobile/FACE_CHECK.md), behind the same FaceVerifier
 * the native SDK plugin will give: InsightFace's detector and ArcFace
 * ResNet50 for who it is, MediaPipe for the blink-and-turn challenge, and
 * MiniFASNet for a photo or screen held up, all on the phone.
 *
 * FOR TESTING ONLY, never with real employees: the recognition weights are
 * for non-commercial research, the liveness is uncertified, and the device
 * key is not in the secure hardware. The server refuses its results unless
 * FACE_ALLOW_PROTOTYPE=1.
 */

/** Every record made with it says so; the server checks the prefix. Changing it makes everyone set their face up again. */
export const FACE_CHECK_MODEL = `${PROTOTYPE_MODEL_PREFIX}insightface-r50-v2`

const MAX_ATTEMPTS = 3

function fail(code: string): never {
    throw Object.assign(new Error(code), { code })
}

export function faceCheckVerifier(openCamera: OpenCamera, store: Store = indexedDbStore()): FaceVerifier {
    const vault = new Vault(store)
    // The whole of the work races the person closing the camera, and is checked
    // once more after: Cancel means nothing is sent, even if it came while the
    // templates were being stored (review on #28).
    const withCamera = async <T>(work: (engine: Engine, camera: Camera) => Promise<T>): Promise<T> => {
        const camera = await openCamera()
        let closed = false
        camera.cancelled.catch(() => { closed = true })
        try {
            camera.say("LOADING")
            const loaded = loadEngine(share => camera.loading?.(share)).finally(() => camera.loading?.(null))
            const result = await Promise.race([loaded.then(engine => work(engine, camera)), camera.cancelled])
            if (closed) fail("FACE_CANCELLED")
            return result
        } finally {
            camera.close()
        }
    }
    return {
        info: async () => ({ modelVersion: FACE_CHECK_MODEL, enrolled: await vault.has("approved"), pending: await vault.has("pending") }),
        enrol: wrappingKey => withCamera(async (engine, camera) => {
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                const c = await capture(engine, camera)
                // The anti-spoofing isn't asked here: a person looks at this photo before it is used.
                if (c.live && c.photo) {
                    await vault.save("pending", wrappingKey, c.templates)
                    return { photo: c.photo }
                }
            }
            return fail("LIVENESS_FAILED")
        }),
        verify: wrappingKey => withCamera(async (engine, camera) => {
            const approved = await vault.load("approved", wrappingKey)
            if (!approved) fail("FACE_NOT_ENROLLED")
            let last: { score: number; liveness: number; frame: string | null } = { score: 0, liveness: 0, frame: null }
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                const c = await capture(engine, camera)
                if (!c.live) {
                    last = { score: 0, liveness: 0, frame: c.frame }
                    continue
                }
                // Both looks of the capture must match the approved face.
                const results = c.templates.map(t => matches(approved, t))
                const score = Math.min(...results.map(r => r.score))
                const liveness = c.real ?? 0
                if (!results.every(r => r.verified)) {
                    last = { score, liveness, frame: c.frame }
                    continue
                }
                // The right face, but the anti-spoofing doubts it's a live one: not refused, sent for a person
                // to look at with the frame (antispoof.ts). Not tried again: the person did everything asked.
                if (liveness < LIVE_SCORE) return { verified: false, score, liveness, attempts: attempt, frame: c.frame }
                return { verified: true, score, liveness, attempts: attempt, frame: null }
            }
            return { verified: false, score: last.score, liveness: last.liveness, attempts: MAX_ATTEMPTS, frame: last.frame }
        }),
        promote: () => vault.promote(),
        discardPending: () => vault.discardPending(),
        deleteTemplates: () => vault.deleteAll(),
    }
}

/** Whether this build of the site offers the face check for testing (NEXT_PUBLIC_FACE_PROTOTYPE=1). */
export const FACE_CHECK = process.env.NEXT_PUBLIC_FACE_PROTOTYPE === "1"
