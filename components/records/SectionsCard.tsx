'use client'

import { useId, useState } from 'react'
import { FolderIcon, FolderPlusIcon, PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import ConfirmModal from '@/components/ConfirmModal'
import { Button, Card, Dialog, EmptyState, Field, RowMenu, TextInput, type MenuItem } from '@/components/ui'
import { useCan } from '@/lib/useCan'
import { countOf } from '@/lib/plural'
import { SECTION_TITLE_MAX } from '@/lib/validations/record.schema'
import type { SectionItem } from './types'

/**
 * A client's sections of records, such as Licences or Contracts, with how
 * many records each holds: added with records.contribute, renamed with
 * records.edit, and deleted, with every record in them, with records.delete.
 */
export default function SectionsCard({ clientId, sections, onChanged }: { clientId: string; sections: SectionItem[]; onChanged: () => void }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { can } = useCan()
    const formId = useId()
    // null: closed; an empty id: adding; a section's id: renaming it.
    const [naming, setNaming] = useState<{ id: string; title: string } | null>(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | undefined>()
    const [deleting, setDeleting] = useState<SectionItem | null>(null)

    const canAdd = can('records.contribute')
    const canRename = can('records.edit')
    const canDelete = can('records.delete')

    const open = (id: string, title: string) => { setError(undefined); setNaming({ id, title }) }

    const save = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!naming) return
        const title = naming.title.trim()
        if (!title) { setError(t('records_section_required')); return }
        setSaving(true)
        try {
            const adding = !naming.id
            const res = await fetch('/api/records/sections', {
                method: adding ? 'POST' : 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(adding ? { clientId, title } : { id: naming.id, title }),
            })
            const body = await res.json().catch(() => null)
            if (!res.ok) {
                setError(body?.error || t('error_generic'))
                return
            }
            showToast(t(adding ? 'records_section_added' : 'records_section_renamed'), 'success')
            setNaming(null)
            onChanged()
        } catch {
            setError(t('error_generic'))
        } finally {
            setSaving(false)
        }
    }

    const confirmDelete = async () => {
        if (!deleting) return
        try {
            const res = await fetch(`/api/records/sections?id=${encodeURIComponent(deleting.id)}`, { method: 'DELETE' })
            const body = await res.json().catch(() => null)
            if (!res.ok) {
                showToast(body?.error || t('error_generic'), 'error')
                return
            }
            showToast(t('records_section_deleted'), 'success')
            onChanged()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setDeleting(null)
        }
    }

    const menu = (s: SectionItem): MenuItem[] => [
        ...(canRename ? [{ key: 'rename', label: t('records_rename_section'), icon: PencilSimpleIcon, onSelect: () => open(s.id, s.title) }] : []),
        ...(canDelete ? [{ key: 'delete', label: t('records_delete_section'), icon: TrashIcon, danger: true, onSelect: () => setDeleting(s) }] : []),
    ]

    return (
        <Card
            title={t('records_sections')}
            actions={canAdd && sections.length > 0 && <Button size="sm" icon={FolderPlusIcon} onClick={() => open('', '')}>{t('records_add_section')}</Button>}
        >
            {sections.length === 0
                ? <EmptyState icon={FolderIcon} title={t('records_no_sections')} action={canAdd && <Button icon={FolderPlusIcon} onClick={() => open('', '')}>{t('records_add_section')}</Button>} />
                : (
                    <ul className="ui-rows ui-rows-flush" aria-label={t('records_sections')}>
                        {sections.map(s => {
                            const items = menu(s)
                            return (
                                <li key={s.id}>
                                    <div className="ui-row">
                                        <span className="ui-row-main"><bdi className="ui-item-title">{s.title}</bdi></span>
                                        <span className="ui-row-end">
                                            <span className="ui-chip">{countOf(t, locale, s.records, 'records')}</span>
                                            {items.length > 0 && <RowMenu label={t('ui_more_actions_for').replace('{name}', s.title)} tooltip={t('ui_more_actions')} items={items} />}
                                        </span>
                                    </div>
                                </li>
                            )
                        })}
                    </ul>
                )}

            <Dialog
                open={!!naming}
                onClose={() => { if (!saving) setNaming(null) }}
                title={t(naming?.id ? 'records_rename_section' : 'records_add_section')}
                actions={<>
                    <Button onClick={() => setNaming(null)} disabled={saving}>{t('cancel')}</Button>
                    <Button type="submit" form={formId} variant="primary" busy={saving}>{t(naming?.id ? 'records_rename_section' : 'records_add_section')}</Button>
                </>}
            >
                <form id={formId} onSubmit={save} className="ui-dialog-body" noValidate>
                    <Field label={t('records_section_name')} error={error}>{p => (
                        <TextInput {...p} value={naming?.title ?? ''} onChange={e => setNaming(n => (n ? { ...n, title: e.target.value } : n))} maxLength={SECTION_TITLE_MAX} autoComplete="off" disabled={saving} />
                    )}</Field>
                </form>
            </Dialog>
            <ConfirmModal
                isOpen={!!deleting}
                title={t('records_delete_section')}
                message={`${deleting && deleting.records > 0
                    ? t('records_delete_section_question').replace('{title}', deleting.title).replace('{count}', countOf(t, locale, deleting.records, 'records'))
                    : t('records_delete_empty_section_question').replace('{title}', deleting?.title ?? '')} ${t('undone_warning_plain')}`}
                confirmText={t('records_delete_section')}
                cancelText={t('cancel')}
                onConfirm={confirmDelete}
                onCancel={() => setDeleting(null)}
                variant="danger"
            />
        </Card>
    )
}
