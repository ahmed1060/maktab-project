'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '@/context/LanguageContext'
import type { TranslationKey } from '@/lib/translations'
import type { Camera, OpenCamera } from '@/lib/mobile/face-check/camera'
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
 */

type Said = Parameters<Camera['say']>[0]

const PROMPTS: Record<Said, TranslationKey> = {
    LOADING: 'face_cam_loading', WORKING: 'face_cam_working', FACE_CAMERA: 'face_cam_face', TURN_HEAD: 'face_cam_turn',
    LOOK_BACK: 'face_cam_back', BLINK: 'face_cam_blink', OPEN_EYES: 'face_cam_open', HOLD_STILL: 'face_cam_still', ONE_FACE: 'face_cam_one',
    CENTER: 'face_cam_center', CLOSER: 'face_cam_closer', FARTHER: 'face_cam_farther', EXTRA: 'face_cam_extra', DONE: 'face_cam_done',
}

const STEP_ICON: Record<Progress['steps'][number]['challenge'], string> = { TURN: '↔', BLINK: '◡' }

/** The oval, in a 100 × 133 box (3:4, as the picture), centred a little above the middle. */
const OVAL = { cx: 50, cy: 58, rx: 31, ry: 41 }
/** The oval as a path from its top, clockwise, for the ring that fills. */
const RING = `M ${OVAL.cx} ${OVAL.cy - OVAL.ry} A ${OVAL.rx} ${OVAL.ry} 0 1 1 ${OVAL.cx} ${OVAL.cy + OVAL.ry} A ${OVAL.rx} ${OVAL.ry} 0 1 1 ${OVAL.cx} ${OVAL.cy - OVAL.ry}`

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
        let gone = false
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
            .then(async media => {
                if (gone) { media.getTracks().forEach(track => track.stop()); return }
                stream.current = media
                const v = video.current!
                v.srcObject = media
                await v.play()
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
                    // Shown only while it's still downloading: from the phone's cache it's done at once.
                    loading: share => setDownload(share === null || share >= 1 ? null : share),
                    cue,
                    close: () => { stopStream(); cancel.current = null; reset() },
                    cancelled,
                })
            })
            .catch(() => {
                // Granted but couldn't play: the camera mustn't stay on with nothing showing (review on #28).
                stopStream()
                setRequest(null)
                setPrompt(null)
                request.failed(codeError('CAMERA_DENIED'))
            })
        return () => { gone = true }
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

    const current = progress?.steps.find(s => s.current)?.challenge
    const done = prompt === 'DONE'
    const ringColour = done || flash === 'ok' ? 'var(--cam-done)' : flash === 'retry' ? 'var(--cam-warn)' : 'var(--cam-ink)'
    const words = flash === 'retry' ? t('face_cam_slow')
        : download !== null && prompt === 'LOADING' ? t('face_cam_download').replace('{pct}', String(Math.floor(download * 100)))
        : prompt ? t(PROMPTS[prompt]) : ''

    const element = prompt && typeof document !== 'undefined' ? createPortal(
        <div role="dialog" aria-modal="true" aria-label={t('face_cam_title')} className="face-cam" style={{
            position: 'fixed', inset: 0, zIndex: 10000, background: 'var(--cam-ground)', color: 'var(--cam-ink)', overflow: 'hidden',
            direction: locale === 'ar' ? 'rtl' : 'ltr',
        }}>
            <video ref={video} playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            {/* The picture dimmed outside the oval, the oval's ring, and the share of the capture done around it. */}
            <svg aria-hidden viewBox="0 0 100 133" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                <defs>
                    <mask id="oval-cutout">
                        <rect x="-50" y="-50" width="200" height="233" style={{ fill: 'var(--cam-ink)' }} />
                        <ellipse {...OVAL} style={{ fill: 'var(--cam-ground)' }} />
                    </mask>
                </defs>
                <rect x="-50" y="-50" width="200" height="233" mask="url(#oval-cutout)" style={{ fill: 'color-mix(in srgb, var(--cam-ground) 72%, transparent)' }} />
                <ellipse {...OVAL} fill="none" strokeWidth="1.2" style={{ stroke: 'color-mix(in srgb, var(--cam-ink) 28%, transparent)' }} />
                {/* Drawn from the top, clockwise: the share done grows around the oval. */}
                <path d={RING} fill="none" strokeWidth="1.6" strokeLinecap="round" pathLength={100}
                    opacity={done || (fill ?? 0) > 0 ? 1 : 0}
                    strokeDasharray="100 100" strokeDashoffset={100 - Math.round((done ? 1 : fill ?? 0) * 100)}
                    style={{ stroke: ringColour, transition: 'stroke-dashoffset 0.25s ease-out, stroke 0.2s' }} />
            </svg>
            {done && (
                <div aria-hidden className="face-cam-tick" style={{
                    position: 'absolute', left: '50%', top: '44%', width: '4.5rem', height: '4.5rem', marginLeft: '-2.25rem', marginTop: '-2.25rem',
                    borderRadius: '50%', background: 'var(--cam-done)', display: 'grid', placeItems: 'center', fontSize: '2.4rem', fontWeight: 700,
                }}>✓</div>
            )}

            <div style={{ position: 'absolute', insetInline: 0, top: 0, padding: 'max(env(safe-area-inset-top), 0.75rem) 1rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                <button onClick={close} aria-label={t('close')} style={{
                    width: '2.75rem', height: '2.75rem', borderRadius: '50%', border: 'none', background: 'color-mix(in srgb, var(--cam-ground) 45%, transparent)', color: 'var(--cam-ink)',
                    fontSize: '1.4rem', lineHeight: 1, cursor: 'pointer',
                }}>✕</button>
                <span style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem', borderRadius: '999px', background: 'color-mix(in srgb, var(--cam-ground) 45%, transparent)', color: 'color-mix(in srgb, var(--cam-ink) 80%, transparent)' }}>{t('face_cam_prototype')}</span>
            </div>

            <div style={{ position: 'absolute', insetInline: 0, bottom: 0, padding: '0 1rem max(env(safe-area-inset-bottom), 1.5rem)', display: 'grid', justifyItems: 'center', gap: '0.75rem' }}>
                {progress && current && (
                    // The step, only when the check asked for one: what to do, the time left, and for a turn how far.
                    <div style={{ width: 'min(100%, 360px)', padding: '0.75rem 1rem', borderRadius: '1rem', background: 'color-mix(in srgb, var(--cam-ground) 55%, transparent)', backdropFilter: 'blur(8px)', display: 'grid', gap: '0.6rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <span aria-hidden style={{ fontSize: '1.6rem', width: '2rem', textAlign: 'center' }}>{STEP_ICON[current]}</span>
                            <div aria-hidden style={{ flex: 1, height: '4px', borderRadius: '2px', background: 'color-mix(in srgb, var(--cam-ink) 25%, transparent)', overflow: 'hidden' }}>
                                <div style={{ width: `${Math.round(progress.timeLeft * 100)}%`, height: '100%', background: progress.timeLeft < 0.25 ? 'var(--cam-warn)' : 'var(--cam-ink)', transition: 'width 0.2s linear' }} />
                            </div>
                        </div>
                        {current === 'TURN' && (
                            // How far the head is turned, as the person sees it in the mirrored picture; the marks at each end are enough.
                            <div aria-hidden style={{ position: 'relative', height: '10px', borderRadius: '5px', background: 'color-mix(in srgb, var(--cam-ink) 20%, transparent)' }}>
                                <span style={{ position: 'absolute', left: '10%', top: 0, bottom: 0, width: '3px', background: 'var(--cam-done)' }} />
                                <span style={{ position: 'absolute', right: '10%', top: 0, bottom: 0, width: '3px', background: 'var(--cam-done)' }} />
                                {progress.turnAmount !== null && (
                                    <span style={{
                                        position: 'absolute', top: '-4px', width: '18px', height: '18px', borderRadius: '50%', marginLeft: '-9px',
                                        left: `${50 - progress.turnAmount * 40}%`, background: Math.abs(progress.turnAmount) >= 1 ? 'var(--cam-done)' : 'var(--cam-ink)',
                                        transition: 'left 0.1s linear',
                                    }} />
                                )}
                            </div>
                        )}
                    </div>
                )}
                <p role="status" aria-live="polite" style={{
                    margin: 0, padding: '0.7rem 1.1rem', borderRadius: '999px', background: 'color-mix(in srgb, var(--cam-ground) 55%, transparent)', backdropFilter: 'blur(8px)',
                    fontSize: '1.1rem', fontWeight: 600, textAlign: 'center', maxWidth: '360px',
                }}>{words}</p>
            </div>
        </div>,
        document.body,
    ) : null

    return { open, element }
}
