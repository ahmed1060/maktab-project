'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import Modal from '@/components/Modal'
import { useLanguage } from '@/context/LanguageContext'

/**
 * A face photo from a checked, uncached endpoint (ATTENDANCE_PLAN.md §9.5,
 * §13.8), with the viewer's name and the time over it: screenshots can't be
 * prevented on the web, so they say who took them.
 */
export function FacePhoto({ src, label, mark }: { src: string; label: string; mark: string }) {
    return (
        <figure style={{ margin: 0, display: 'grid', gap: '0.35rem' }}>
            <div style={{ position: 'relative', borderRadius: '0.75rem', overflow: 'hidden', background: 'var(--glass-bg)', userSelect: 'none' }} onContextMenu={e => e.preventDefault()}>
                {/* eslint-disable-next-line @next/next/no-img-element -- streamed through a checked, uncached endpoint; next/image would cache it */}
                <img src={src} alt={label} draggable={false} style={{ display: 'block', width: '100%', maxHeight: '22rem', objectFit: 'contain' }} />
                <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'grid', alignContent: 'space-around', justifyItems: 'center', overflow: 'hidden' }}>
                    {[0, 1, 2].map(i => (
                        <span key={i} style={{ transform: 'rotate(-24deg)', color: 'var(--chip-solid-fg)', background: 'var(--chip-solid-bg)', padding: '0 0.35rem', borderRadius: '0.25rem', opacity: 0.55, fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{mark}</span>
                    ))}
                </div>
            </div>
            <figcaption style={{ color: 'var(--text-soft)', fontSize: '0.78rem' }}>{label}</figcaption>
        </figure>
    )
}

/** The viewer's name and the moment the photos opened, for the watermark. */
export function useWatermark() {
    const { data: session } = useSession()
    const [openedAt] = useState(() => new Date().toISOString().slice(0, 16).replace('T', ' '))
    return `${session?.user?.name ?? session?.user?.email ?? ''} · ${openedAt}`
}

/** A flagged check-in's failed face frame beside the person's approved photo (§13.8). */
export function FlaggedFaceModal({ punchId, name, onClose }: { punchId: string; name: string; onClose: () => void }) {
    const { t } = useLanguage()
    const mark = useWatermark()
    return (
        <Modal isOpen onClose={onClose} title={t('face_review_title').replace('{name}', name)}>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
                <p style={{ margin: 0, color: 'var(--text-soft)', fontSize: '0.8rem' }}>{t('face_flag_compare')}</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '0.75rem' }}>
                    <FacePhoto src={`/api/attendance/flagged/${punchId}/face?which=frame`} label={t('face_flag_frame')} mark={mark} />
                    <FacePhoto src={`/api/attendance/flagged/${punchId}/face?which=reference`} label={t('face_photo_reference')} mark={mark} />
                </div>
            </div>
        </Modal>
    )
}
