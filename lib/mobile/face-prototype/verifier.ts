import type { FaceVerifier } from "@/lib/mobile/face"
import { loadFaceApi } from "./engine"
import { capture } from "./capture"
import { matches } from "./match"
import { indexedDbStore, Vault, type Store } from "./vault"
import type { OpenCamera } from "./camera"
import { PROTOTYPE_MODEL_PREFIX } from "@/lib/attendance/face-prototype-gate"

/**
 * The free prototype of the face SDK (mobile/README.md, "Free prototype"),
 * behind the same FaceVerifier the native plugin will give. For trying the
 * whole flow on your own phone, never with real employees: its liveness is
 * an uncertified challenge, and its device key is not in the secure
 * hardware. The server refuses its results unless FACE_ALLOW_PROTOTYPE=1.
 */

/** Every record made with it says so; the server checks the prefix. */
export const PROTOTYPE_MODEL = `${PROTOTYPE_MODEL_PREFIX}dlib-resnet-v1`

const MAX_ATTEMPTS = 3

function fail(code: string): never {
    throw Object.assign(new Error(code), { code })
}

export function prototypeFaceVerifier(openCamera: OpenCamera, store: Store = indexedDbStore()): FaceVerifier {
    const vault = new Vault(store)
    // The whole of the work races the person closing the camera, and is checked
    // once more after: Cancel means nothing is sent, even if it came while the
    // templates were being stored (review on #28).
    const withCamera = async <T>(work: (api: Awaited<ReturnType<typeof loadFaceApi>>, camera: Awaited<ReturnType<OpenCamera>>) => Promise<T>): Promise<T> => {
        const camera = await openCamera()
        let closed = false
        camera.cancelled.catch(() => { closed = true })
        try {
            camera.say("LOADING")
            const result = await Promise.race([loadFaceApi().then(api => work(api, camera)), camera.cancelled])
            if (closed) fail("FACE_CANCELLED")
            return result
        } finally {
            camera.close()
        }
    }
    return {
        info: async () => ({ modelVersion: PROTOTYPE_MODEL, enrolled: await vault.has("approved"), pending: await vault.has("pending") }),
        enrol: wrappingKey => withCamera(async (api, camera) => {
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                const c = await capture(api, camera)
                if (c.live && c.photo) {
                    await vault.save("pending", wrappingKey, c.descriptors)
                    return { photo: c.photo }
                }
            }
            return fail("LIVENESS_FAILED")
        }),
        verify: wrappingKey => withCamera(async (api, camera) => {
            const approved = await vault.load("approved", wrappingKey)
            if (!approved) fail("FACE_NOT_ENROLLED")
            let last: { score: number; liveness: number; frame: string | null } = { score: 0, liveness: 0, frame: null }
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                const c = await capture(api, camera)
                if (c.live) {
                    // Both looks of the capture must match the approved face.
                    const results = c.descriptors.map(d => matches(approved, d))
                    const score = Math.min(...results.map(r => r.score))
                    if (results.every(r => r.verified)) return { verified: true, score, liveness: 1, attempts: attempt, frame: null }
                    last = { score, liveness: 1, frame: c.frame }
                } else {
                    last = { score: 0, liveness: 0, frame: c.frame }
                }
            }
            return { verified: false, score: last.score, liveness: last.liveness, attempts: MAX_ATTEMPTS, frame: last.frame }
        }),
        promote: () => vault.promote(),
        discardPending: () => vault.discardPending(),
        deleteTemplates: () => vault.deleteAll(),
    }
}

/** Whether this build of the site offers the prototype (NEXT_PUBLIC_FACE_PROTOTYPE=1). */
export const FACE_PROTOTYPE = process.env.NEXT_PUBLIC_FACE_PROTOTYPE === "1"
