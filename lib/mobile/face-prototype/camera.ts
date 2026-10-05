import type { Cue, Progress, Prompt } from "./liveness"

/**
 * The camera, as the prototype sees it: a live video of the front camera,
 * a line of instruction for the person, and a way out. The check-in screen
 * provides it (components/FaceCamera.tsx).
 */
export interface Camera {
    video: HTMLVideoElement
    say(prompt: Prompt | "LOADING" | "WORKING"): void
    /** The steps, the time left on this one and the live readings, during the challenge; null clears them. */
    show?(progress: Progress | null): void
    /** A step half or wholly done, or started again: felt and heard, not only read. */
    cue?(cue: Cue): void
    close(): void
    /** Rejects with FACE_CANCELLED when the person closes the camera. */
    cancelled: Promise<never>
}

export type OpenCamera = () => Promise<Camera>

/** A JPEG of the video's current frame, in base64, under `maxBytes`. */
export function snapshot(video: HTMLVideoElement, maxBytes = 380_000): string {
    const scale = Math.min(1, 640 / (video.videoWidth || 640))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round((video.videoWidth || 640) * scale)
    canvas.height = Math.round((video.videoHeight || 480) * scale)
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height)
    for (let quality = 0.85; ; quality -= 0.15) {
        const b64 = canvas.toDataURL("image/jpeg", quality).split(",")[1]
        if (b64.length * 0.75 <= maxBytes || quality <= 0.3) return b64
    }
}
