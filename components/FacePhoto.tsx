'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { Button, Dialog } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'

/**
 * A face photo from a checked, uncached endpoint (ATTENDANCE_PLAN.md §9.5,
 * §13.8), with the viewer's name and the time over it: screenshots can't be
 * prevented on the web, so they say who took them.
 */
export function FacePhoto({ src, label, mark }: { src: string; label: string; mark: string }) {
    // The building blocks' look (components/ui/ui.css), wherever it's shown (PR 153).
    return (
        <figure className="ui-face-photo">
            <div className="ui-face-photo-frame" onContextMenu={e => e.preventDefault()}>
                {/* eslint-disable-next-line @next/next/no-img-element -- streamed through a checked, uncached endpoint; next/image would cache it */}
                <img src={src} alt={label} draggable={false} />
                <div aria-hidden className="ui-face-photo-marks">
                    {[0, 1, 2].map(i => <span key={i}>{mark}</span>)}
                </div>
            </div>
            <figcaption>{label}</figcaption>
        </figure>
    )
}

/** The viewer's name and the moment the photos opened, for the watermark. */
export function useWatermark() {
    const { data: session } = useSession()
    const [openedAt] = useState(() => new Date().toISOString().slice(0, 16).replace('T', ' '))
    return `${session?.user?.name ?? session?.user?.email ?? ''} · ${openedAt}`
}

/**
 * A flagged check-in's failed face frame beside the person's approved photo
 * (§13.8), in the building blocks' dialog (DESIGN.md §5.5, Face photos; PR
 * 216). It was the older pages' window.
 */
export function FlaggedFaceDialog({ punchId, name, onClose }: { punchId: string; name: string; onClose: () => void }) {
    const { t } = useLanguage()
    const mark = useWatermark()
    return (
        <Dialog open onClose={onClose} title={t('face_review_title').replace('{name}', name)}
            // Close, to look and come back later: on a phone there's no Escape key.
            actions={<Button onClick={onClose}>{t('close')}</Button>}>
            <p>{t('face_flag_compare')}</p>
            <div className="ui-face-photos">
                <FacePhoto src={`/api/attendance/flagged/${punchId}/face?which=frame`} label={t('face_flag_frame')} mark={mark} />
                <FacePhoto src={`/api/attendance/flagged/${punchId}/face?which=reference`} label={t('face_photo_reference')} mark={mark} />
            </div>
        </Dialog>
    )
}
