'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, ConfirmDialog, FilePicker, Photo } from '@/components/ui'
import { PHOTO_ACCEPT, photoProblem, removePhoto, savePhoto } from '@/lib/profile-photo'

/**
 * A person's photo at the top of their profile (DESIGN.md §5.5, A person's
 * photo), and where it can be changed, what changes it beside it: a file
 * picker for one image, and Remove photo, which asks first. Saved at once,
 * without the form's own button.
 *
 * It was a circle of its own making, with a drawn man or woman for someone
 * with no photo, and a window of its own to see it larger before it could
 * be changed (PR 191).
 */

/** What shows: drawn from what it's given, so each state can be seen as it is. */
export function PhotoRow({ name, src, canChange, uploading, error, onFiles, onRemove }: {
    name: string
    src: string | null
    canChange: boolean
    uploading: boolean
    /** What's wrong with the file picked, or why it wasn't saved. */
    error: string | null
    onFiles: (files: File[]) => void
    onRemove: () => void
}) {
    const { t } = useLanguage()
    return (
        <div className="ui-photo-row">
            <Photo name={name} src={src} alt={t('profile_photo_of').replace('{name}', name)} />
            {canChange && (
                <div className="ui-photo-controls">
                    <FilePicker label={t(src ? 'profile_photo_change' : 'profile_photo_upload')} hint={t('profile_photo_hint')} accept={PHOTO_ACCEPT} multiple={false} disabled={uploading} onFiles={onFiles} />
                    {/* There from the start, so a screen reader hears it when it speaks. */}
                    <p className="ui-hint" role="status">{uploading ? t('profile_photo_uploading') : ''}</p>
                    {error && <p className="ui-error" role="alert">{error}</p>}
                    {src && <Button variant="quiet" disabled={uploading} onClick={onRemove}>{t('profile_photo_remove')}</Button>}
                </div>
            )}
        </div>
    )
}

export function ProfilePhoto({ userId, name, photo, canChange, own, onChange }: {
    userId: string
    name: string
    photo: string | null
    canChange: boolean
    /** Their own: the account menu's photo follows. */
    own: boolean
    /** The photo they have now, once it's saved. */
    onChange: (photo: string | null) => void
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const { update } = useSession()
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [removing, setRemoving] = useState(false)

    const upload = async ([file]: File[]) => {
        if (!file) return
        const problem = photoProblem(file)
        if (problem) {
            setError(t(problem))
            return
        }
        setError(null)
        setUploading(true)
        try {
            const saved = await savePhoto(userId, file, t('profile_photo_failed'))
            if ('error' in saved) {
                setError(saved.error)
                return
            }
            onChange(saved.url)
            if (own) await update({ avatar: saved.url, image: saved.url, picture: saved.url })
            showToast(t('profile_photo_saved'), 'success')
        } finally {
            setUploading(false)
        }
    }

    // The confirmation stays open and busy until this is done, and open if it fails.
    const remove = async () => {
        const done = await removePhoto(userId, t('profile_photo_remove_failed'))
        if ('error' in done) {
            showToast(done.error, 'error')
            return
        }
        onChange(null)
        setError(null)
        if (own) await update({ avatar: null, image: null, picture: null })
        setRemoving(false)
        showToast(t('profile_photo_removed'), 'success')
    }

    return (
        <>
            <PhotoRow name={name} src={photo} canChange={canChange} uploading={uploading} error={error} onFiles={upload} onRemove={() => setRemoving(true)} />
            <ConfirmDialog
                open={removing}
                title={t('profile_photo_remove')}
                body={t('profile_photo_remove_question')}
                confirmLabel={t('profile_photo_remove')}
                danger
                onConfirm={remove}
                onCancel={() => setRemoving(false)}
            />
        </>
    )
}
