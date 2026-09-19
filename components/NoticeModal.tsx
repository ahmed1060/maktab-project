'use client'

import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useHydrated } from '@/lib/useHydrated'

export type NoticeVariant = 'success' | 'error' | 'info'

export type Notice = {
    variant: NoticeVariant
    title: string
    message?: string
    /** Shown under the message in a monospace block — an error reference, a count, a path. */
    detail?: string
}

interface NoticeModalProps {
    notice: Notice | null
    onClose: () => void
    closeText?: string
}

/**
 * What the browser's alert() was doing, in the application's own theme.
 *
 * alert() is a native dialog: it ignores the palette entirely, so on a dark
 * page it opened as a light grey box in the browser's chrome font. It also
 * blocks the main thread, which is why a success message could sit on top of a
 * button still rendering "Saving...".
 *
 * Deliberately the same geometry, scrim and animation as ConfirmModal — they
 * are a pair, one asking and one reporting, and should read as siblings. The
 * difference is the button count: this one has nothing to decide, so it has a
 * single dismiss.
 */
const VARIANTS: Record<NoticeVariant, { bg: string; fg: string; solid: string; hover: string; path: React.ReactNode }> = {
    success: {
        bg: 'var(--ok-bg)',
        fg: 'var(--ok-fg-strong)',
        solid: 'var(--ok-solid)',
        hover: 'var(--ok-solid-hover)',
        path: <><path d="M20 6L9 17l-5-5" /></>,
    },
    error: {
        bg: 'var(--danger-bg)',
        fg: 'var(--danger-solid-hover)',
        solid: 'var(--danger-solid-hover)',
        hover: 'var(--danger-fg-strong)',
        path: <><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
    },
    info: {
        bg: 'var(--info-bg-indigo)',
        fg: 'var(--info-solid)',
        solid: 'var(--info-solid)',
        hover: 'var(--info-solid-hover)',
        path: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>,
    },
}

export default function NoticeModal({ notice, onClose, closeText }: NoticeModalProps) {
    const { t, locale } = useLanguage()
    const mounted = useHydrated()
    const dismissRef = useRef<HTMLButtonElement>(null)

    // Escape closes it, and the dismiss button takes focus when it opens — an
    // alert() could always be cleared with a keystroke and this should not be
    // the change that makes people reach for the mouse.
    useEffect(() => {
        if (!notice) return
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        dismissRef.current?.focus()
        return () => document.removeEventListener('keydown', onKey)
    }, [notice, onClose])

    if (!notice || !mounted) return null

    const style = VARIANTS[notice.variant]
    const isRtl = locale === 'ar'

    return createPortal(
        <div
            role="alertdialog"
            aria-modal="true"
            aria-label={notice.title}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'var(--scrim)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 10000,
                animation: 'fadeIn 0.2s ease-out',
                padding: '1.5rem',
            }}
            onClick={onClose}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: 'var(--surface)',
                    padding: '2rem',
                    borderRadius: '12px',
                    width: 'min(100%, 450px)',
                    position: 'relative',
                    boxShadow: '0 20px 25px -5px var(--shadow-weak), 0 10px 10px -5px var(--shadow-faint)',
                    animation: 'slideUp 0.3s ease-out',
                    direction: isRtl ? 'rtl' : 'ltr',
                    textAlign: isRtl ? 'right' : 'left',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        background: style.bg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={style.fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            {style.path}
                        </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--text-main)', margin: '0 0 0.5rem 0' }}>
                            {notice.title}
                        </h2>
                        {notice.message && (
                            <p style={{ fontSize: '0.875rem', color: 'var(--text-soft)', margin: 0, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                                {notice.message}
                            </p>
                        )}
                        {notice.detail && (
                            <pre style={{
                                margin: '0.75rem 0 0',
                                padding: '0.6rem 0.75rem',
                                background: 'var(--surface-sunk)',
                                borderRadius: '0.5rem',
                                fontSize: '0.8rem',
                                fontFamily: 'monospace',
                                color: 'var(--text-muted)',
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                                direction: 'ltr',
                                textAlign: 'left',
                            }}>{notice.detail}</pre>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        ref={dismissRef}
                        onClick={onClose}
                        style={{
                            padding: '0.625rem 1.25rem',
                            border: 'none',
                            borderRadius: '0.5rem',
                            background: style.solid,
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            color: 'var(--text-on-accent)',
                            transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = style.hover }}
                        onMouseLeave={e => { e.currentTarget.style.background = style.solid }}
                    >
                        {closeText || t('close') || 'Close'}
                    </button>
                </div>
            </div>

            <style jsx global>{`
                @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px) }
                    to { opacity: 1; transform: translateY(0) }
                }
                @media (prefers-reduced-motion: reduce) {
                    [role="alertdialog"], [role="alertdialog"] > * { animation: none !important }
                }
            `}</style>
        </div>,
        document.body
    )
}
