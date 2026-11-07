'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ArrowsHorizontalIcon, CheckIcon, EyeClosedIcon, XIcon } from '@phosphor-icons/react/ssr'
import { Icon, type PhosphorIcon } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useDialog } from '@/lib/useDialog'
import type { TranslationKey } from '@/lib/translations'
import { ringShare, startCapture, type Camera, type OpenCamera } from '@/lib/mobile/face-check/camera'
import type { Cue, Progress } from '@/lib/mobile/face-check/liveness'
import { chime, pageAudio } from '@/lib/mobile/face-check/chime'

/**
 * The front camera, full screen, for the face check for testing
 * (lib/mobile/face-check), laid out as the phone face checks people know:
 * the live picture, mirrored as a mirror is, with an oval to fit the face in
 * and a ring around it that fills as the check takes its looks, turning green
 * with a tick when it's done. One line says what to do. A step (a turn or a
 * blink) appears only when the check has doubts, with how far along it is;
 * each step half or wholly done flashes the ring, vibrates (Android; an
 * iPhone web view can't) and beeps, so a turn or closed eyes don't leave the
 * person guessing. `open()` resolves once the camera is streaming.
 *
 * The first time, the face check's models download (about 200 MB, kept on
 * the phone after): the line says how far.
 *
 * On the building blocks (DESIGN.md §5.5, "The face check's camera"; PR
 * 216): drawn by components/ui/ui.css, its icons Phosphor's, and a dialog by
 * useDialog, which takes the focus as it opens, keeps Tab inside and ends
 * the check on Escape.
 */

type Said = Parameters<Camera['say']>[0]

const PROMPTS: Record<Said, TranslationKey> = {
    LOADING: 'face_cam_loading', WORKING: 'face_cam_working', FACE_CAMERA: 'face_cam_face', TURN_HEAD: 'face_cam_turn',
    LOOK_BACK: 'face_cam_back', BLINK: 'face_cam_blink', OPEN_EYES: 'face_cam_open', HOLD_STILL: 'face_cam_still', ONE_FACE: 'face_cam_one',
    CENTER: 'face_cam_center', CLOSER: 'face_cam_closer', FARTHER: 'face_cam_farther', UPRIGHT: 'face_cam_upright', EXTRA: 'face_cam_extra', DONE: 'face_cam_done',
}

const STEP_ICON: Record<Progress['steps'][number]['challenge'], PhosphorIcon> = { TURN: ArrowsHorizontalIcon, BLINK: EyeClosedIcon }

/** The oval, in a 100 × 133 box (3:4, as the picture), centred a little above the middle. */
const OVAL = { cx: 50, cy: 58, rx: 31, ry: 41 }
/** The oval as a path from its top, clockwise, for the ring that fills. */
const RING = `M ${OVAL.cx} ${OVAL.cy - OVAL.ry} A ${OVAL.rx} ${OVAL.ry} 0 1 1 ${OVAL.cx} ${OVAL.cy + OVAL.ry} A ${OVAL.rx} ${OVAL.ry} 0 1 1 ${OVAL.cx} ${OVAL.cy - OVAL.ry}`

/** The picture's cut-out for the oval: one camera shows at a time. */
const CUTOUT = 'ui-camera-cutout'

/**
 * The line at the bottom: a step started again, the first download's share
 * in the page's digits, or what the check asks.
 */
export function cameraLine(t: (key: TranslationKey) => string, locale: string, { prompt, download, retry }: { prompt: Said; download: number | null; retry: boolean }): string {
    if (retry) return t('face_cam_slow')
    if (download !== null && prompt === 'LOADING') {
        const share = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { style: 'percent', maximumFractionDigits: 0 }).format(Math.floor(download * 100) / 100)
        return t('face_cam_download').replace('{pct}', share)
    }
    return t(PROMPTS[prompt])
}

/**
 * What the camera shows, from where the capture has got (DESIGN.md §5.5):
 * the picture with its oval and ring, Close, the step the check asks for
 * when it has doubts, and the line saying what to do.
 */
export function CameraScreen({ video, line, progress, ring, tone, done, onClose }: {
    video: RefObject<HTMLVideoElement | null>
    line: string
    progress: Progress | null
    /** How much of the ring shows, 0 to 1 (ringShare). */
    ring: number
    /** The ring's colour: the ink, done or a step started again. */
    tone: 'ink' | 'done' | 'warn'
    done: boolean
    onClose: () => void
}) {
    const { t } = useLanguage()
    // Drawn only while a capture is open: the focus comes in, and goes back to what opened it.
    const dialog = useDialog(true, onClose, { label: t('face_cam_title') })
    const step = progress?.steps.find(s => s.current)?.challenge
    return (
        <div {...dialog.panelProps} className="ui-camera">
            {/* The live picture says nothing to a screen reader: the line below speaks to it. */}
            <video ref={video} className="ui-camera-video" aria-hidden="true" playsInline muted />
            {/* The picture dimmed outside the oval, the oval's edge, and the share of the capture done around it. */}
            <svg aria-hidden="true" className="ui-camera-guide" viewBox="0 0 100 133" preserveAspectRatio="xMidYMid slice">
                <defs>
                    <mask id={CUTOUT}>
                        <rect className="ui-camera-mask-show" x="-50" y="-50" width="200" height="233" />
                        <ellipse className="ui-camera-mask-hide" {...OVAL} />
                    </mask>
                </defs>
                <rect className="ui-camera-dim" x="-50" y="-50" width="200" height="233" mask={`url(#${CUTOUT})`} />
                <ellipse className="ui-camera-oval" {...OVAL} />
                {/* Drawn from the top, clockwise: the share done grows around the oval. */}
                <path className="ui-camera-ring" data-tone={tone} d={RING} pathLength={100}
                    strokeDasharray="100 100" strokeDashoffset={100 - Math.round(ring * 100)} opacity={ring > 0 ? 1 : 0} />
            </svg>
            {done && <div aria-hidden="true" className="ui-camera-tick"><Icon icon={CheckIcon} size={40} /></div>}

            <div className="ui-camera-top">
                <button type="button" className="ui-camera-close" onClick={onClose} aria-label={t('close')}><Icon icon={XIcon} size={22} /></button>
                <p className="ui-camera-note">{t('face_cam_prototype')}</p>
            </div>

            <div className="ui-camera-bottom">
                {progress && step && (
                    // The step, only when the check asked for one: what it is, the time left, and for a turn how far.
                    <div className="ui-camera-step">
                        <div className="ui-camera-step-head">
                            <Icon icon={STEP_ICON[step]} size={20} />
                            <span>{t(`face_cam_step_${step}`)}</span>
                            <span aria-hidden="true" className="ui-camera-time" data-late={progress.timeLeft < 0.25 || undefined}
                                style={{ ['--left' as string]: progress.timeLeft } as CSSProperties}><span /></span>
                        </div>
                        {step === 'TURN' && (
                            // How far the head is turned, as the person sees it in the mirrored picture: a direction on
                            // the screen, not in the words, so it isn't mirrored in Arabic. The marks at each end are enough.
                            <div aria-hidden="true" className="ui-camera-turn" dir="ltr">
                                <span className="ui-camera-turn-mark" />
                                <span className="ui-camera-turn-mark" />
                                {progress.turnAmount !== null && (
                                    <span className="ui-camera-turn-dot" data-enough={Math.abs(progress.turnAmount) >= 1 || undefined}
                                        style={{ ['--turn' as string]: progress.turnAmount } as CSSProperties} />
                                )}
                            </div>
                        )}
                    </div>
                )}
                <p role="status" className="ui-camera-line">{line}</p>
            </div>
        </div>
    )
}

function vibrate(pattern: number | number[]) {
    try { navigator.vibrate?.(pattern) } catch { /* no vibration is fine */ }
}

function codeError(code: string) {
    return Object.assign(new Error(code), { code })
}

export function useFaceCamera(): { open: OpenCamera; element: React.ReactNode } {
    const { t, locale } = useLanguage()
    // Shown while a capture is open; `request` is set until the camera is streaming.
    const [prompt, setPrompt] = useState<Said | null>(null)
    const [request, setRequest] = useState<null | { ready: (c: Camera) => void; failed: (e: Error) => void }>(null)
    const video = useRef<HTMLVideoElement | null>(null)
    const stream = useRef<MediaStream | null>(null)
    const cancel = useRef<((e: Error) => void) | null>(null)
    const [progress, setProgress] = useState<Progress | null>(null)
    const [fill, setFill] = useState<number | null>(null)
    const [download, setDownload] = useState<number | null>(null)
    const [flash, setFlash] = useState<'ok' | 'retry' | null>(null)
    // Started by any tap on the page: by the time the camera opens, the tap that asked for it is too long ago
    // for the browser to let sound start (review on #30).
    const [sound] = useState(() => chime(pageAudio))
    const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const cue = useCallback((c: Cue) => {
        if (c === 'RETRY') { vibrate([80, 60, 80]); sound.play(330, 250) }
        else if (c === 'HALF') { vibrate(40); sound.play(660, 90) }
        else { vibrate(120); sound.play(880, 160) }
        setFlash(c === 'RETRY' ? 'retry' : 'ok')
        if (flashTimer.current) clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => setFlash(null), c === 'RETRY' ? 2500 : 450)
    }, [sound])

    useEffect(() => {
        const unlock = () => sound.unlock()
        const events = ['pointerdown', 'touchend', 'keydown'] as const
        events.forEach(e => document.addEventListener(e, unlock, { capture: true, passive: true }))
        return () => events.forEach(e => document.removeEventListener(e, unlock, { capture: true }))
    }, [sound])

    const stopStream = () => {
        stream.current?.getTracks().forEach(track => track.stop())
        stream.current = null
    }

    const reset = () => {
        setPrompt(null)
        setProgress(null)
        setFill(null)
        setDownload(null)
    }

    const open: OpenCamera = useCallback(() => new Promise<Camera>((ready, failed) => {
        sound.unlock()
        setProgress(null)
        setFill(null)
        setDownload(null)
        setPrompt('LOADING')
        setRequest({ ready, failed })
    }), [sound])

    // Once the overlay is up: the camera, then the session handed back.
    useEffect(() => {
        if (!request || !video.current) return
        const v = video.current
        return startCapture({
            ready: () => {
                const cancelled = new Promise<never>((_, reject) => { cancel.current = reject })
                cancelled.catch(() => {})
                setRequest(null)
                request.ready({
                    video: v,
                    say: next => setPrompt(p => (p ? next : p)),
                    show: setProgress,
                    fill: setFill,
                    visible: () => {
                        // object-fit: cover: the picture scaled to fill the screen, the overflow cut off evenly.
                        const vw = v.videoWidth, vh = v.videoHeight, ew = v.clientWidth, eh = v.clientHeight
                        if (!vw || !vh || !ew || !eh) return { x: 0, y: 0, w: 1, h: 1 }
                        const scale = Math.max(ew / vw, eh / vh)
                        const w = Math.min(1, ew / scale / vw), h = Math.min(1, eh / scale / vh)
                        return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
                    },
                    // The oval is drawn for a tall screen (review on #48).
                    upright: () => v.clientHeight >= v.clientWidth,
                    // Shown only while it's still downloading: from the phone's cache it's done at once.
                    loading: share => setDownload(share === null || share >= 1 ? null : share),
                    cue,
                    close: () => { stopStream(); cancel.current = null; reset() },
                    cancelled,
                })
            },
            // Refused, couldn't play, or closed or left while it started: the capture waiting on it is told,
            // never left waiting (review on #28).
            failed: error => request.failed(error),
        },
        () => navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }),
        async media => { stream.current = media; v.srcObject = media; await v.play() },
        // Only while this capture is still the one showing (Codex review on #49): the camera off, the overlay down.
        () => { stopStream(); setRequest(null); setPrompt(null) })
    }, [request, cue])

    // Leaving the page mid-capture: the capture is cancelled and the camera turned off (review on #28).
    useEffect(() => () => {
        cancel.current?.(codeError('FACE_CANCELLED'))
        cancel.current = null
        stopStream()
    }, [])

    const close = () => {
        cancel.current?.(codeError('FACE_CANCELLED'))
        cancel.current = null
        stopStream()
        request?.failed(codeError('FACE_CANCELLED'))
        setRequest(null)
        reset()
    }

    const done = prompt === 'DONE'
    const tone = done || flash === 'ok' ? 'done' : flash === 'retry' ? 'warn' : 'ink'
    // Whole while a cue flashes it, so a step's cues show on the ring too (review on #48).
    const ring = ringShare(fill, done, flash !== null)

    const element = prompt && typeof document !== 'undefined' ? createPortal(
        <CameraScreen video={video} line={cameraLine(t, locale, { prompt, download, retry: flash === 'retry' })}
            progress={progress} ring={ring} tone={tone} done={done} onClose={close} />,
        document.body,
    ) : null

    return { open, element }
}
