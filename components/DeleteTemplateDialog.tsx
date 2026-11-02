'use client'

import { Button, Dialog } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'

/**
 * Deleting a template, a role's or an attendance policy's: asked first, in
 * the danger colour, saying what becomes of the companies' copies. It stays
 * open, its button busy, until the delete is done (the Super Admin's pages
 * part 1, UI_PLAN.md §5 step 5).
 */
export default function DeleteTemplateDialog({ name, body, busy, onCancel, onConfirm }: {
    name: string
    body: string
    busy: boolean
    onCancel: () => void
    onConfirm: () => void
}) {
    const { t } = useLanguage()
    return (
        <Dialog
            open
            onClose={() => { if (!busy) onCancel() }}
            title={t('roles_delete_title').replace('{name}', name)}
            actions={<>
                <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
                <Button variant="danger" busy={busy} onClick={onConfirm}>{t('delete')}</Button>
            </>}
        >
            <p>{body}</p>
        </Dialog>
    )
}
