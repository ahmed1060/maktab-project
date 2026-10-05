/**
 * The face check's beeps. Browsers, and an iPhone's web view above all, only
 * let sound start from a tap; the camera opens after the tap, once the app
 * has fetched what it needs, which is too late (review on #30). So the audio
 * is started by any tap on the page (`unlock`), and a beep before that is
 * simply silent.
 */

type AudioCtor = new () => AudioContext

export type Chime = { unlock(): void; play(frequency: number, ms: number): void }

export function chime(audioCtor: () => AudioCtor | undefined): Chime {
    let ctx: AudioContext | null = null
    return {
        unlock() {
            try {
                const Ctor = audioCtor()
                if (!Ctor) return
                ctx ??= new Ctor()
                if (ctx.state === "suspended") void ctx.resume().catch(() => {})
            } catch {
                ctx = null
            }
        },
        play(frequency, ms) {
            if (!ctx || ctx.state !== "running") return
            try {
                const osc = ctx.createOscillator()
                const gain = ctx.createGain()
                osc.frequency.value = frequency
                gain.gain.value = 0.08
                osc.connect(gain)
                gain.connect(ctx.destination)
                osc.start()
                osc.stop(ctx.currentTime + ms / 1000)
            } catch { /* no sound is fine */ }
        },
    }
}

/** The page's own AudioContext, under either name. */
export const pageAudio = (): AudioCtor | undefined =>
    typeof window === "undefined" ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
