import type { Box, Cue, Progress, Prompt } from "./liveness"

/**
 * What the face check says while it fits the face in the oval and takes its
 * looks: hold the phone upright, centre the face, come closer or move back,
 * one more step when it has doubts, and done.
 */
export type FitPrompt = "CENTER" | "CLOSER" | "FARTHER" | "UPRIGHT" | "EXTRA" | "DONE"

/**
 * The camera, as the face check sees it: a live video of the front camera,
 * a line of instruction for the person, and a way out. The check-in screen
 * provides it (components/FaceCamera.tsx).
 */
export interface Camera {
    video: HTMLVideoElement
    say(prompt: Prompt | FitPrompt | "LOADING" | "WORKING"): void
    /** How far the automatic capture has got, 0 to 1, for the ring around the oval; null clears it. */
    fill?(share: number | null): void
    /**
     * The part of the picture the person sees, as shares of its width and height: the screen crops the
     * camera's picture to fill it, and the face is fitted to the oval as it appears there.
     */
    visible?(): Box
    /**
     * Whether the phone is held upright. The oval is drawn for a tall screen: turned on its side, the screen
     * cut off its top and bottom, and the fit no longer matched what showed (review on #48).
     */
    upright?(): boolean
    /** How far the first download of the models has got, 0 to 1; null once they're loaded. */
    loading?(share: number | null): void
    /** The step, the time left on it and the live readings, while one is asked for; null clears them. */
    show?(progress: Progress | null): void
    /** A step half or wholly done, or started again: felt and heard, not only read. */
    cue?(cue: Cue): void
    close(): void
    /** Rejects with FACE_CANCELLED when the person closes the camera. */
    cancelled: Promise<never>
}

export type OpenCamera = () => Promise<Camera>

/**
 * How much of the ring around the oval shows, 0 to 1: the capture's share, all of it once done, and all of it
 * while a cue flashes it. A step clears the share, and its cues (half done, done, start again) flashed the colour
 * of a ring that wasn't there: on a phone that can't vibrate, nothing showed them (review on #48).
 */
export function ringShare(fill: number | null, done: boolean, flashing: boolean): number {
    if (done) return 1
    if (fill !== null) return fill
    return flashing ? 1 : 0
}

/**
 * The camera, started for a capture the page may leave while it starts: asked for, then playing. If `gone()`
 * turns true while either waits, the camera is turned off again and this rejects with FACE_CANCELLED, so the
 * capture never waits for good, and nothing starts on a page that has gone (review on #28). A camera refused, or
 * one that won't play, rejects with CAMERA_DENIED and is off.
 */
export async function startCamera(ask: () => Promise<MediaStream>, play: (media: MediaStream) => Promise<void>, gone: () => boolean): Promise<MediaStream> {
    const failed = (code: string) => Object.assign(new Error(code), { code })
    const media = await ask().catch(() => { throw failed("CAMERA_DENIED") })
    const stop = () => media.getTracks().forEach(track => track.stop())
    if (gone()) { stop(); throw failed("FACE_CANCELLED") }
    await play(media).catch(() => { stop(); throw failed("CAMERA_DENIED") })
    if (gone()) { stop(); throw failed("FACE_CANCELLED") }
    return media
}

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
