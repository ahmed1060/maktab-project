'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '@/context/LanguageContext'
import type { TranslationKey } from '@/lib/translations'
import type { Camera, OpenCamera } from '@/lib/mobile/face-prototype/camera'

/**
 * The front camera, full screen, for the face check prototype
 * (lib/mobile/face-prototype): the live picture, mirrored as a mirror is,
 * one line telling the person what to do, and a way out. `open()` resolves
 * once the camera is streaming.
 */

type Said = Parameters<Camera['say']>[0]

const PROMPTS: Record<Said, TranslationKey> = {
    LOADING: 'face_cam_loading', WORKING: 'face_cam_working', FACE_CAMERA: 'face_cam_face', TURN_HEAD: 'face_cam_turn',
    LOOK_BACK: 'face_cam_back', BLINK: 'face_cam_blink', HOLD_STILL: 'face_cam_still', ONE_FACE: 'face_cam_one',
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

    const stopStream = () => {
        stream.current?.getTracks().forEach(track => track.stop())
        stream.current = null
    }

    const open: OpenCamera = useCallback(() => new Promise<Camera>((ready, failed) => {
        setPrompt('LOADING')
        setRequest({ ready, failed })
    }), [])

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
                    close: () => { stopStream(); cancel.current = null; setPrompt(null) },
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
    }, [request])

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
    }

    const element = prompt && typeof document !== 'undefined' ? createPortal(
        <div role="dialog" aria-modal="true" aria-label={t('face_cam_title')} style={{
            position: 'fixed', inset: 0, zIndex: 10000, background: 'var(--scrim)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '1rem',
            direction: locale === 'ar' ? 'rtl' : 'ltr',
        }}>
            <div style={{ width: 'min(100%, 420px)', aspectRatio: '3 / 4', borderRadius: '50% / 40%', overflow: 'hidden', border: '4px solid var(--chip-solid-bg)' }}>
                <video ref={video} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            </div>
            <p role="status" aria-live="polite" style={{ margin: 0, padding: '0.6rem 1rem', borderRadius: '0.75rem', background: 'var(--surface)', color: 'var(--text-main)', fontSize: '1.05rem', textAlign: 'center', maxWidth: '420px' }}>
                {t(PROMPTS[prompt])}
            </p>
            <p style={{ margin: 0, padding: '0.35rem 0.75rem', borderRadius: '0.5rem', background: 'var(--surface)', fontSize: '0.75rem', color: 'var(--text-soft)', textAlign: 'center', maxWidth: '420px' }}>{t('face_cam_prototype')}</p>
            <button className="btn btn-secondary" onClick={close}>{t('cancel')}</button>
        </div>,
        document.body,
    ) : null

    return { open, element }
}
