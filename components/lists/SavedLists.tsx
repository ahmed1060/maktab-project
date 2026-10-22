'use client'

import { useId, useMemo, useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import type { ListKind } from '@prisma/client'
import {
    ArchiveIcon, ArrowCounterClockwiseIcon, ArrowsMergeIcon, HourglassIcon, ListBulletsIcon, PencilSimpleIcon, PlusIcon, WarningCircleIcon,
} from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import ConfirmModal from '@/components/ConfirmModal'
import {
    Button, DataList, Dialog, EmptyState, Field, FilterBar, ItemTitle, ListCard, Pager, RowMenu, SearchInput, Select, StatusBadge, Tabs, TextInput,
    type Column, type MenuItem,
} from '@/components/ui'
import type { TranslationKey } from '@/lib/translations'
import { LIST_NAME_LIMITS } from '@/lib/saved-lists'
import { forScope, loadFailed, scopedFetcher, scopedKey } from '@/lib/swr-scoped'
import { useCan } from '@/lib/useCan'
import { countOf } from '@/lib/plural'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'

type Name = { id: string; name: string; archived: boolean; uses: number }

/**
 * A company's saved lists, to manage (CLIENTS_PLAN.md §5.6): its cost names
 * and its task titles, each name with how often it's been picked. Names are
 * added, renamed, merged into another, archived and restored here; a name is
 * in a list once, ignoring capitals.
 */
export default function SavedLists({ adding, onAddingChange }: {
    /** Whether the add form is open, for a page whose header has the button. */
    adding: boolean
    onAddingChange: (open: boolean) => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { can } = useCan()
    const { data: session } = useSession()
    const { selectedCompanyId } = useCompany()
    const superAdmin = (session?.user as { role?: string } | undefined)?.role === 'SUPER_ADMIN'
    const [kind, setKind] = useState<ListKind>('COST_NAME')
    const [query, setQuery] = useState('')
    const [renaming, setRenaming] = useState<Name | null>(null)
    const [merging, setMerging] = useState<Name | null>(null)
    const [toArchive, setToArchive] = useState<Name | null>(null)

    // A Super Admin's are the company they've picked; until then, none.
    const waitsForCompany = superAdmin && !selectedCompanyId
    const params = new URLSearchParams({ kind, manage: '1' })
    if (superAdmin && selectedCompanyId) params.set('companyId', selectedCompanyId)
    const url = waitsForCompany ? null : `/api/lists?${params}`
    const scope = `${selectedCompanyId ?? ''}:${kind}`
    const { data: scoped, error, isLoading, isValidating, mutate } = useSWR(scopedKey(url, scope), scopedFetcher, { keepPreviousData: true })
    const failed = loadFailed(scoped, error, url)
    const loaded = forScope<{ data: Name[] }>(scoped, scope)?.data
    const all: Name[] = useMemo(() => (failed ? [] : loaded ?? []), [failed, loaded])
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase()
        return q ? all.filter(n => n.name.toLowerCase().includes(q)) : all
    }, [all, query])

    // Another company's or list's names open in a form are closed, so none is changed unseen.
    useAdjustOnChange([scope], () => { setRenaming(null); setMerging(null); setToArchive(null); onAddingChange(false) })

    /** A change to a name: renaming, merging, archiving or restoring it. False when it was refused, with why. */
    const change = async (body: Record<string, unknown>, done: TranslationKey, method: 'POST' | 'PUT' = 'PUT') => {
        try {
            const res = await fetch('/api/lists', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            const answer = await res.json().catch(() => null)
            if (!res.ok) {
                showToast(answer?.error || t('error_generic'), 'error')
                return false
            }
            showToast(t(done), 'success')
            void mutate()
            return true
        } catch {
            showToast(t('error_generic'), 'error')
            return false
        }
    }

    const menu = (n: Name): MenuItem[] => n.archived
        ? [{ key: 'restore', label: t('lists_restore'), icon: ArrowCounterClockwiseIcon, onSelect: () => { void change({ id: n.id, archived: false }, 'lists_restored') } }]
        : [
            { key: 'rename', label: t('lists_rename'), icon: PencilSimpleIcon, onSelect: () => setRenaming(n) },
            { key: 'merge', label: t('lists_merge'), icon: ArrowsMergeIcon, onSelect: () => setMerging(n) },
            { key: 'archive', label: t('lists_archive'), icon: ArchiveIcon, onSelect: () => setToArchive(n) },
        ]
    const actions = (n: Name) => (
        <span className="ui-row-actions">
            <RowMenu label={t('ui_more_actions_for').replace('{name}', n.name)} tooltip={t('ui_more_actions')} items={menu(n)} />
        </span>
    )
    const badge = (n: Name) => n.archived && <StatusBadge tone="neutral">{t('lists_archived_badge')}</StatusBadge>
    const columns: Column<Name>[] = [
        { key: 'name', header: t('lists_col_name'), cell: n => <ItemTitle title={<><bdi>{n.name}</bdi>{badge(n)}</>} /> },
        { key: 'uses', header: t('lists_col_uses'), cell: n => countOf(t, locale, n.uses, 'times') },
        { key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end', cell: actions },
    ]

    const empty = waitsForCompany
        ? <EmptyState icon={ListBulletsIcon} title={t('lists_pick_company')} />
        : failed
            ? <EmptyState icon={WarningCircleIcon} title={t('lists_load_failed')} action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
            : query.trim()
                ? <EmptyState icon={ListBulletsIcon} title={t('lists_none_found')} action={<Button variant="quiet" onClick={() => setQuery('')}>{t('ui_reset_filters')}</Button>} />
                : <EmptyState icon={ListBulletsIcon} title={t('lists_none')}
                    action={can('lists.add') ? <Button variant="primary" icon={PlusIcon} onClick={() => onAddingChange(true)}>{t('lists_add_name')}</Button> : undefined} />

    const company = superAdmin && selectedCompanyId ? { companyId: selectedCompanyId } : {}

    return (
        <>
            <Tabs
                label={t('lists_kind_label')}
                idPrefix="lists"
                value={kind}
                onChange={next => { setKind(next); setQuery('') }}
                items={[
                    { value: 'COST_NAME', label: t('lists_tab_cost_names') },
                    { value: 'TASK_TITLE', label: t('lists_tab_task_titles') },
                ]}
            />
            <FilterBar
                search={<Field label={t('lists_search')} hideLabel>{p => <SearchInput {...p} autoComplete="off" placeholder={t('lists_search')} value={query} onChange={e => setQuery(e.target.value)} />}</Field>}
                activeCount={0}
                onReset={query ? () => setQuery('') : undefined}
            />
            {isLoading && !scoped && !failed
                ? <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('lists_loading')} /></div>
                : (
                    <DataList
                        caption={t(kind === 'COST_NAME' ? 'lists_tab_cost_names' : 'lists_tab_task_titles')}
                        columns={columns}
                        rows={shown}
                        rowKey={n => n.id}
                        card={n => (
                            <ListCard
                                title={<bdi>{n.name}</bdi>}
                                status={badge(n) || undefined}
                                details={[{ icon: ListBulletsIcon, text: countOf(t, locale, n.uses, 'times') }]}
                                foot={actions(n)}
                            />
                        )}
                        footer={shown.length > 0 ? <Pager page={1} pageCount={1} onPage={() => {}} summary={countOf(t, locale, shown.length, 'names')} /> : undefined}
                        empty={empty}
                    />
                )}

            <NameForm
                open={adding && !waitsForCompany}
                title={t('lists_add_name')}
                kind={kind}
                initial=""
                save={name => change({ kind, name, ...company }, 'lists_added', 'POST')}
                onClose={() => onAddingChange(false)}
            />
            <NameForm
                open={!!renaming}
                title={t('lists_rename')}
                kind={kind}
                initial={renaming?.name ?? ''}
                save={name => change({ id: renaming!.id, name }, 'lists_renamed')}
                onClose={() => setRenaming(null)}
            />
            <MergeForm
                from={merging}
                into={all.filter(n => !n.archived && n.id !== merging?.id)}
                merge={into => change({ id: merging!.id, into }, 'lists_merged')}
                onClose={() => setMerging(null)}
            />
            <ConfirmModal
                isOpen={!!toArchive}
                title={t('lists_archive')}
                message={t('lists_archive_question').replace('{name}', toArchive?.name ?? '')}
                confirmText={t('lists_archive')}
                cancelText={t('cancel')}
                onConfirm={async () => { if (toArchive) await change({ id: toArchive.id, archived: true }, 'lists_archived_done'); setToArchive(null) }}
                onCancel={() => setToArchive(null)}
                variant="warning"
            />
        </>
    )
}

/** A name to add or rename, as long as its list takes. */
function NameForm({ open, title, kind, initial, save, onClose }: {
    open: boolean
    title: string
    kind: ListKind
    initial: string
    save: (name: string) => Promise<boolean>
    onClose: () => void
}) {
    if (!open) return null
    return <NameFormBody title={title} kind={kind} initial={initial} save={save} onClose={onClose} />
}

function NameFormBody({ title, kind, initial, save, onClose }: { title: string; kind: ListKind; initial: string; save: (name: string) => Promise<boolean>; onClose: () => void }) {
    const { t } = useLanguage()
    const formId = useId()
    const [name, setName] = useState(initial)
    const [saving, setSaving] = useState(false)
    const { max } = LIST_NAME_LIMITS[kind]
    const submit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim() || saving) return
        setSaving(true)
        const ok = await save(name.trim())
        setSaving(false)
        if (ok) onClose()
    }
    return (
        <Dialog open onClose={() => { if (!saving) onClose() }} title={title} actions={<>
            <Button onClick={onClose} disabled={saving}>{t('cancel')}</Button>
            <Button type="submit" form={formId} variant="primary" busy={saving} disabled={!name.trim()}>{t('save')}</Button>
        </>}>
            <form id={formId} onSubmit={submit} className="ui-dialog-body" noValidate>
                <Field label={t('lists_name_label')} hint={`${name.length}/${max}`}>{p => (
                    <TextInput {...p} value={name} onChange={e => setName(e.target.value)} maxLength={max} autoComplete="off" disabled={saving} />
                )}</Field>
            </form>
        </Dialog>
    )
}

/** Merging a name into another of its list (§5.6). */
function MergeForm({ from, into, merge, onClose }: {
    from: Name | null
    into: Name[]
    merge: (into: string) => Promise<boolean>
    onClose: () => void
}) {
    if (!from) return null
    return <MergeFormBody from={from} into={into} merge={merge} onClose={onClose} />
}

function MergeFormBody({ from, into, merge, onClose }: { from: Name; into: Name[]; merge: (into: string) => Promise<boolean>; onClose: () => void }) {
    const { t } = useLanguage()
    const [target, setTarget] = useState('')
    const [saving, setSaving] = useState(false)
    const submit = async () => {
        if (!target || saving) return
        setSaving(true)
        const ok = await merge(target)
        setSaving(false)
        if (ok) onClose()
    }
    return (
        <Dialog open onClose={() => { if (!saving) onClose() }} title={t('lists_merge_title').replace('{name}', from.name)} actions={<>
            <Button onClick={onClose} disabled={saving}>{t('cancel')}</Button>
            <Button variant="primary" busy={saving} disabled={!target} onClick={() => { void submit() }}>{t('lists_merge_confirm')}</Button>
        </>}>
            {into.length === 0
                ? <p className="ui-hint">{t('lists_merge_none')}</p>
                : (
                    <Field label={t('lists_merge_into_label')} hint={t('lists_merge_hint').replaceAll('{name}', from.name)}>{p => (
                        <Select {...p} icon={ArrowsMergeIcon} value={target} onChange={e => setTarget(e.target.value)} disabled={saving}
                            options={[{ value: '', label: t('lists_merge_pick') }, ...into.map(n => ({ value: n.id, label: n.name }))]} />
                    )}</Field>
                )}
        </Dialog>
    )
}
