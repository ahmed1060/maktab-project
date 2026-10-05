import type { Descriptor } from "./match"
import type { Landmarks } from "./liveness"

/**
 * The prototype's face models, run in the app's web view on the phone
 * (@vladmandic/face-api, MIT): a small face detector, the 68 landmarks, and
 * dlib's face recognition network, whose weights are public domain. Loaded
 * only when the prototype is used; the weights are served from the site
 * (/face-models, copied at build by scripts/copy-face-models.mjs).
 */

type FaceApi = typeof import("@vladmandic/face-api")

export const MODELS_URL = "/face-models"

let loading: Promise<FaceApi> | null = null

export function loadFaceApi(): Promise<FaceApi> {
    loading ??= (async () => {
        const api = await import("@vladmandic/face-api")
        await Promise.all([
            api.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
            api.nets.faceLandmark68Net.loadFromUri(MODELS_URL),
            api.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
        ])
        return api
    })().catch(e => { loading = null; throw e })
    return loading
}

export type Look = { faces: number; landmarks: Landmarks | null; descriptor: Descriptor | null }

/** One look at the camera: how many faces, and for exactly one, its landmarks and (when asked) its descriptor. */
export async function look(api: FaceApi, video: HTMLVideoElement, withDescriptor: boolean): Promise<Look> {
    // A smaller input during the challenge, where only the landmarks are needed:
    // more looks a second, so a blink isn't missed between two of them.
    const options = new api.TinyFaceDetectorOptions({ inputSize: withDescriptor ? 320 : 224, scoreThreshold: 0.5 })
    const found = withDescriptor
        ? await api.detectAllFaces(video, options).withFaceLandmarks().withFaceDescriptors()
        : await api.detectAllFaces(video, options).withFaceLandmarks()
    if (found.length !== 1) return { faces: found.length, landmarks: null, descriptor: null }
    const one = found[0] as (typeof found)[number] & { descriptor?: Float32Array }
    return {
        faces: 1,
        landmarks: one.landmarks.positions.map(p => ({ x: p.x, y: p.y })),
        descriptor: one.descriptor ? Array.from(one.descriptor) : null,
    }
}
