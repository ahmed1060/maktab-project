'use client'

import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import { companyLabel } from '@/lib/company-name'
import { Button, Details, Dialog, ExpiryDate, FileChip, FileChips } from '@/components/ui'
import { countOf } from '@/lib/plural'
import { clientName } from '@/lib/client-list'
import { authorName, formatDay, formatMoment, type RecordItem } from './types'

/**
 * A record whole, opened from a list that cuts its text short (DESIGN.md
 * §5.5): its text, files, expiry and reminder, and who added and last edited
 * it, with the actions the person may take on it.
 */
export default function RecordDialog({ record, onClose, showClient, onEdit, onDelete }: {
    record: RecordItem | null
    onClose: () => void
    /** The client it's kept for, on the Records page; its own page says so already. */
    showClient: boolean
    onEdit?: () => void
    onDelete?: () => void
}) {
    const { t, locale } = useLanguage()
    if (!record) return null
    const details = [
        ...(showClient ? [{ label: t('records_col_client'), value: <Link href={`/dashboard/clients/${record.client.id}`} prefetch={false}><bdi>{clientName(record.client, locale)}</bdi></Link> }] : []),
        // Its company, for a Super Admin, who sees every company's (Codex on #82).
        ...(record.client.company ? [{ label: t('company_label'), value: <bdi>{companyLabel(locale, record.client.company, record.client.companyAr)}</bdi> }] : []),
        { label: t('records_section'), value: <bdi>{record.section.title}</bdi> },
        {
            label: t('records_expiry_date'),
            value: record.expiryDate ? <ExpiryDate state={record.expiry}>{formatDay(record.expiryDate, locale)}</ExpiryDate> : t('records_no_expiry'),
        },
        ...(record.expiryDate ? [{
            label: t('records_reminder_label'),
            value: record.reminderDays ? t('records_reminder_before').replace('{days}', countOf(t, locale, record.reminderDays, 'days')) : t('records_reminder_none'),
        }] : []),
        { label: t('records_col_added'), value: <>{authorName(record.createdBy, record.createdBySuperAdmin, t, locale)}<div className="ui-item-detail">{formatMoment(record.createdAt, locale)}</div></> },
        ...(record.lastEditedAt ? [{
            label: t('records_edited_by'),
            value: <>{authorName(record.lastEditedBy, record.lastEditedBySuperAdmin, t, locale)}<div className="ui-item-detail">{formatMoment(record.lastEditedAt, locale)}</div></>,
        }] : []),
    ]
    return (
        <Dialog
            open
            onClose={onClose}
            title={t('records_record')}
            actions={<>
                {onDelete && <Button variant="quiet" onClick={onDelete}>{t('records_delete')}</Button>}
                <Button onClick={onClose}>{t('close')}</Button>
                {onEdit && <Button variant="primary" onClick={onEdit}>{t('records_edit')}</Button>}
            </>}
        >
            <p className="ui-prose" dir="auto">{record.content}</p>
            {record.files.length > 0 && (
                <FileChips label={t('records_files')}>
                    {record.files.map(f => <FileChip key={f.url} name={f.name} size={f.size} href={f.url} />)}
                </FileChips>
            )}
            <Details items={details} />
        </Dialog>
    )
}
