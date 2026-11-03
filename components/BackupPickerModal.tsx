'use client'

import { Fragment, type ReactNode } from 'react'
import { WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, Dialog, EmptyState, Row } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { fileSize } from '@/lib/record-files'
import { DEFAULT_TIME_ZONE } from '@/lib/time'
import type { TranslationKey } from '@/lib/translations'

export type BackupEntry = {
    folder: 'daily' | 'weekly' | 'monthly'
    baseName: string
    sizeBytes: number
    modifiedTime: string
}

const FOLDER: Record<BackupEntry['folder'], TranslationKey> = { daily: 'backup_folder_daily', weekly: 'backup_folder_weekly', monthly: 'backup_folder_monthly' }

/**
 * The backups on Google Drive, to pick one to restore (System health). On
 * the building blocks (UI_PLAN.md §5 step 5, Operations part 3b): a dialog
 * listing each backup as a row, its name as it's stored, which kind, when
 * and how big, with Restore on its end side; picking one asks again, for a
 * word typed (components/HealthDialogs.tsx). It was a window of its own
 * making, with a spinner, sizes and colours typed in and " · " between the
 * facts.
 */
export default function BackupPickerModal({ isOpen, backups, loading, error, reason, onSelect, onClose, onRetry }: {
    isOpen: boolean
    backups: BackupEntry[]
    loading: boolean
    error: string | null
    /** Why, as the server said it, such as that Google Drive couldn't be reached. */
    reason?: string | null
    onSelect: (backup: BackupEntry) => void
    onClose: () => void
    /** Asks Google Drive again, after it didn't answer. */
    onRetry?: () => void
}) {
    const { t, locale } = useLanguage()
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    // When, where the platform is, as every other time on it.
    const when = (iso: string) => new Date(iso).toLocaleString(intl, { dateStyle: 'medium', timeStyle: 'short', timeZone: DEFAULT_TIME_ZONE })
    // Each fact kept apart from the next, so a date can't swap places with
    // the words beside it in Arabic.
    const facts = (items: (string | false)[]): ReactNode => (
        <span>{items.filter(Boolean).map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}<bdi>{x}</bdi></Fragment>)}</span>
    )

    return (
        <Dialog open={isOpen} onClose={onClose} title={t('choose_backup_to_restore')} actions={<Button onClick={onClose}>{t('cancel')}</Button>}>
            {loading ? (
                <p role="status">{t('backup_picker_loading')}</p>
            ) : error ? (
                <EmptyState icon={WarningCircleIcon} title={error} detail={reason} action={onRetry && <Button onClick={onRetry}>{t('try_again')}</Button>} />
            ) : backups.length === 0 ? (
                <p>{t('backup_picker_empty')}</p>
            ) : (
                <ul className="ui-rows" aria-label={t('choose_backup_to_restore')}>
                    {backups.map(b => (
                        <Row
                            key={`${b.folder}/${b.baseName}`}
                            // The file's name, as it's stored: left to right, never translated.
                            title={<bdi dir="ltr" translate="no">{b.baseName}</bdi>}
                            detail={facts([t(FOLDER[b.folder]), !!b.modifiedTime && when(b.modifiedTime), fileSize(b.sizeBytes, locale)])}
                            // Named for which, for someone hearing the list rather than seeing it.
                            end={<Button size="sm" aria-label={t('backup_picker_select_named').replace('{name}', b.baseName)} onClick={() => onSelect(b)}>{t('backup_picker_select')}</Button>}
                        />
                    ))}
                </ul>
            )}
        </Dialog>
    )
}
