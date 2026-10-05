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
 * (lib/mobile/face-check): the live picture, mirrored as a mirror is,
 * one line telling the person what to do, and a way out. `open()` resolves
 * once the camera is streaming.
 *
 * During the challenge it also shows which steps are done, the time left on
 * this one, and how far the head is turned; and each step half or wholly done
 * flashes the frame green, vibrates (Android; an iPhone web view can't) and
 * beeps, so a turn or closed eyes don't leave the person guessing. Found on
 * the first try on a phone: with only the words, nobody could tell whether
 * looking back had counted.
 *
 * The first time, the face check's models download (about 200 MB, kept on
 * the phone after): a bar shows how far.
 */

type Said = Parameters<Camera['say']>[0]

const PROMPTS: Record<Said, TranslationKey> = {
    LOADING: 'face_cam_loading', WORKING: 'face_cam_working', FACE_CAMERA: 'face_cam_face', TURN_HEAD: 'face_cam_turn',
    LOOK_BACK: 'face_cam_back', BLINK: 'face_cam_blink', OPEN_EYES: 'face_cam_open', HOLD_STILL: 'face_cam_still', ONE_FACE: 'face_cam_one',
}

const STEP_LABEL: Record<Progress['steps'][number]['challenge'], TranslationKey> = { TURN: 'face_cam_step_TURN', BLINK: 'face_cam_step_BLINK' }

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

    const open: OpenCamera = useCallback(() => new Promise<Camera>((ready, failed) => {
        sound.unlock()
        setProgress(null)
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
                    // Shown only while it's still downloading: from the phone's cache it's done at once.
                    loading: share => setDownload(share === null || share >= 1 ? null : share),
                    cue,
                    close: () => { stopStream(); cancel.current = null; setPrompt(null); setProgress(null); setDownload(null) },
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
        setPrompt(null)
        setProgress(null)
        setDownload(null)
    }

    const current = progress?.steps.find(s => s.current)?.challenge
    const frameColour = flash === 'ok' ? 'var(--ok-fill)' : flash === 'retry' ? 'var(--warn-fill)' : 'var(--chip-solid-bg)'

    const element = prompt && typeof document !== 'undefined' ? createPortal(
        <div role="dialog" aria-modal="true" aria-label={t('face_cam_title')} style={{
            position: 'fixed', inset: 0, zIndex: 10000, background: 'var(--scrim)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '1rem',
            direction: locale === 'ar' ? 'rtl' : 'ltr',
        }}>
            {progress && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {progress.steps.map(s => (
                        <span key={s.challenge} style={{
                            padding: '0.3rem 0.75rem', borderRadius: '999px', fontSize: '0.9rem', background: 'var(--surface)',
                            color: s.done ? 'var(--ok-fg)' : 'var(--text-main)',
                            border: s.current ? '2px solid var(--primary)' : '2px solid transparent',
                        }}>{s.done ? '✓ ' : ''}{t(STEP_LABEL[s.challenge])}</span>
                    ))}
                </div>
            )}
            <div style={{ width: 'min(100%, 420px)', aspectRatio: '3 / 4', borderRadius: '50% / 40%', overflow: 'hidden', border: `6px solid ${frameColour}`, transition: 'border-color 0.15s' }}>
                <video ref={video} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            </div>
            {progress && current && (
                <div aria-hidden style={{ width: 'min(100%, 420px)', height: '6px', borderRadius: '3px', background: 'var(--surface)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round(progress.timeLeft * 100)}%`, height: '100%', background: progress.timeLeft < 0.25 ? 'var(--warn-fill)' : 'var(--primary)', transition: 'width 0.2s linear' }} />
                </div>
            )}
            {progress && current === 'TURN' && (
                // How far the head is turned, as the person sees it in the mirrored picture; the marks at each end are enough.
                <div aria-hidden style={{ position: 'relative', width: 'min(80%, 320px)', height: '14px', borderRadius: '7px', background: 'var(--surface)' }}>
                    <span style={{ position: 'absolute', left: '10%', top: 0, bottom: 0, width: '3px', background: 'var(--ok-fill)' }} />
                    <span style={{ position: 'absolute', right: '10%', top: 0, bottom: 0, width: '3px', background: 'var(--ok-fill)' }} />
                    {progress.turnAmount !== null && (
                        <span style={{
                            position: 'absolute', top: '-3px', width: '20px', height: '20px', borderRadius: '50%', marginLeft: '-10px',
                            left: `${50 - progress.turnAmount * 40}%`,
                            background: Math.abs(progress.turnAmount) >= 1 ? 'var(--ok-fill)' : 'var(--primary)',
                        }} />
                    )}
                </div>
            )}
            {download !== null && (
                <div aria-hidden style={{ width: 'min(100%, 420px)', height: '6px', borderRadius: '3px', background: 'var(--surface)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round(download * 100)}%`, height: '100%', background: 'var(--primary)', transition: 'width 0.2s linear' }} />
                </div>
            )}
            <p role="status" aria-live="polite" style={{ margin: 0, padding: '0.6rem 1rem', borderRadius: '0.75rem', background: 'var(--surface)', color: 'var(--text-main)', fontSize: '1.05rem', textAlign: 'center', maxWidth: '420px' }}>
                {flash === 'retry' ? t('face_cam_slow') : download !== null && prompt === 'LOADING' ? t('face_cam_download').replace('{pct}', String(Math.floor(download * 100))) : t(PROMPTS[prompt])}
            </p>
            {progress && (
                // The live readings, for tuning the test version on real phones.
                <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-soft)', fontFamily: 'monospace' }}>
                    {`eyes ${progress.eyes === null ? '–' : progress.eyes.toFixed(2)} · turn ${progress.turnAmount === null ? '–' : progress.turnAmount.toFixed(2)}`}
                </p>
            )}
            <p style={{ margin: 0, padding: '0.35rem 0.75rem', borderRadius: '0.5rem', background: 'var(--surface)', fontSize: '0.75rem', color: 'var(--text-soft)', textAlign: 'center', maxWidth: '420px' }}>{t('face_cam_prototype')}</p>
            <button className="btn btn-secondary" onClick={close}>{t('cancel')}</button>
        </div>,
        document.body,
    ) : null

    return { open, element }
}
