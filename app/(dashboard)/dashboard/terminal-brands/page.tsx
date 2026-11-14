'use client'

import { Fragment, useId, useRef, useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { ArrowCounterClockwiseIcon, FingerprintIcon, HourglassIcon, PencilSimpleIcon, PlusIcon, ProhibitIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { Button, ConfirmDialog, Dialog, EmptyState, Field, Page, PageHeader, Row, RowMenu, Rows, Select, StatusBadge, TextArea, TextInput, type MenuItem } from '@/components/ui'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { apiErrorText } from '@/lib/api-error-text'
import { countOf } from '@/lib/plural'
import type { TranslationKey } from '@/lib/translations'

/**
 * Terminal brands (ATTENDANCE_PLAN.md §17.9, Phase 4 part 3, PR 279): what
 * is printed on a fingerprint terminal, kept by the Super Admin for every
 * company, each with the protocol its terminals speak. Protocols are code,
 * so only the two Nizmo speaks are offered.
 *
 * On the building blocks, as Policy templates: the page header with Add a
 * brand, the brands as rows with a menu. A brand no terminal has had is
 * deleted; one a terminal has is retired instead, keeping its place on the
 * list with a badge, and Put back offers it again (DESIGN.md §5.5, Row
 * menu). Its protocol can't change while a terminal has it.
 */

type Protocol = 'ZKTECO' | 'HIKVISION'
const PROTOCOLS: Protocol[] = ['ZKTECO', 'HIKVISION']
type Brand = { id: string; name: string; protocol: Protocol; notesEn: string | null; notesAr: string | null; retiredAt: string | null; terminalCount: number }
type Editing = { brand: Brand | null }
type Asking = { brand: Brand; action: 'retire' | 'delete' }

const protocolKey = (p: Protocol) => `tbrand_protocol_${p}` as TranslationKey

export default function TerminalBrandsPage() {
    const { t, locale } = useLanguage()
    const isRtl = locale === 'ar'
    const { showToast } = useToast()
    const { data: session, status } = useSession()
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

    const { data, error, isValidating, mutate } = useSWR(isSuperAdmin ? '/api/terminal-brands' : null, fetcher)
    const brands: Brand[] | null = data ? data.data?.brands ?? [] : null
    const [editing, setEditing] = useState<Editing | null>(null)
    const [asking, setAsking] = useState<Asking | null>(null)

    if (status === 'loading') return null
    if (!isSuperAdmin) return <AccessDenied superAdmins />

    // The ones offered first, the retired after them (DESIGN.md §5.5, Row menu).
    const shown = brands ? [...brands].sort((a, b) => Number(a.retiredAt !== null) - Number(b.retiredAt !== null)) : null

    /** Its notes in the page's language, or else the other's, marked as that language. */
    const notes = (b: Brand) => {
        const own = isRtl ? b.notesAr : b.notesEn
        if (own) return <bdi>{own}</bdi>
        const other = isRtl ? b.notesEn : b.notesAr
        return other ? <bdi lang={isRtl ? 'en' : 'ar'}>{other}</bdi> : null
    }
    const detail = (b: Brand) => {
        const parts = [
            t(protocolKey(b.protocol)),
            b.terminalCount > 0 ? countOf(t, locale, b.terminalCount, 'terminals') : t('tbrand_used_none'),
        ]
        return <span>{parts.map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}<bdi>{x}</bdi></Fragment>)}</span>
    }

    /** Posts a change, says how it went, and loads the list again; false when it didn't go through. */
    const act = async (path: string, method: string, done: TranslationKey): Promise<boolean> => {
        try {
            const res = await fetch(path, { method })
            if (!res.ok) {
                showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
                return false
            }
            showToast(t(done), 'success')
            await mutate()
            return true
        } catch {
            showToast(t('error_generic'), 'error')
            return false
        }
    }

    const menu = (b: Brand): MenuItem[] => [
        { key: 'edit', label: t('edit'), icon: PencilSimpleIcon, onSelect: () => setEditing({ brand: b }) },
        b.retiredAt
            ? { key: 'restore', label: t('tbrand_put_back'), icon: ArrowCounterClockwiseIcon, onSelect: () => { void act(`/api/terminal-brands/${b.id}/restore`, 'POST', 'tbrand_put_back_done') } }
            : b.terminalCount > 0
                ? { key: 'retire', label: t('tbrand_retire'), icon: ProhibitIcon, onSelect: () => setAsking({ brand: b, action: 'retire' }) }
                : { key: 'delete', label: t('delete'), icon: TrashIcon, danger: true, onSelect: () => setAsking({ brand: b, action: 'delete' }) },
    ]

    return (
        <Page>
            <PageHeader
                title={t('tbrand_title')}
                subtitle={t('tbrand_hint')}
                action={<Button variant="primary" icon={PlusIcon} onClick={() => setEditing({ brand: null })}>{t('tbrand_add')}</Button>}
            />

            {!shown ? (
                error ? (
                    <div className="ui-panel">
                        <EmptyState icon={WarningCircleIcon} title={t('tbrand_load_failed')} detail={(error as SWRError).info?.error}
                            action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    </div>
                ) : (
                    <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
                )
            ) : shown.length === 0 ? (
                <div className="ui-panel"><EmptyState icon={FingerprintIcon} title={t('tbrand_none')} /></div>
            ) : (
                <Rows label={t('tbrand_title')}>
                    {shown.map(b => (
                        <Row
                            key={b.id}
                            title={<bdi translate="no">{b.name}</bdi>}
                            detail={detail(b)}
                            note={notes(b)}
                            end={<>
                                {b.retiredAt && <StatusBadge tone="neutral">{t('tbrand_retired_badge')}</StatusBadge>}
                                <RowMenu label={t('ui_more_actions_for').replace('{name}', b.name)} tooltip={t('ui_more_actions')} items={menu(b)} />
                            </>}
                        />
                    ))}
                </Rows>
            )}

            {editing && <BrandDialog brand={editing.brand} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await mutate() }} />}

            <ConfirmDialog
                open={!!asking}
                title={asking ? t(asking.action === 'retire' ? 'tbrand_retire_title' : 'tbrand_delete_title').replace('{name}', asking.brand.name) : ''}
                body={asking ? t(asking.action === 'retire' ? 'tbrand_retire_body' : 'tbrand_delete_body') : ''}
                confirmLabel={asking?.action === 'retire' ? t('tbrand_retire_confirm') : t('tbrand_delete_confirm')}
                danger={asking?.action === 'delete'}
                onCancel={() => setAsking(null)}
                onConfirm={async () => {
                    if (!asking) return
                    const { brand: b, action } = asking
                    const done = action === 'retire'
                        ? await act(`/api/terminal-brands/${b.id}/retire`, 'POST', 'tbrand_retired_done')
                        : await act(`/api/terminal-brands/${b.id}`, 'DELETE', 'tbrand_deleted')
                    // Kept open when it fails, to try again or cancel.
                    if (done) setAsking(null)
                }}
            />
        </Page>
    )
}

/**
 * Add a brand, or change one: its name as printed on it, the protocol its
 * terminals speak, locked while any has it, and notes in each language. A
 * name missing or already taken is said under its field, and the focus
 * moves there (DESIGN.md §5.3).
 */
function BrandDialog({ brand, onClose, onSaved }: { brand: Brand | null; onClose: () => void; onSaved: () => Promise<void> }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const formId = useId()
    const formRef = useRef<HTMLFormElement>(null)
    const [name, setName] = useState(brand?.name ?? '')
    const [protocol, setProtocol] = useState<Protocol>(brand?.protocol ?? 'ZKTECO')
    const [notesEn, setNotesEn] = useState(brand?.notesEn ?? '')
    const [notesAr, setNotesAr] = useState(brand?.notesAr ?? '')
    const [nameError, setNameError] = useState<string | undefined>()
    const [saving, setSaving] = useState(false)
    const locked = !!brand && brand.terminalCount > 0

    const submit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (saving) return
        if (!name.trim()) { setNameError(t('tbrand_name_required')); focusFirstWrong(formRef.current); return }
        setSaving(true)
        try {
            const res = await fetch(brand ? `/api/terminal-brands/${brand.id}` : '/api/terminal-brands', {
                method: brand ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), protocol, notesEn: notesEn.trim() || null, notesAr: notesAr.trim() || null }),
            })
            if (!res.ok) {
                const text = await res.text()
                // A name already taken is said under the name (DESIGN.md §5.3).
                if (res.status === 409 && text.includes('BRAND_NAME_TAKEN')) { setNameError(t('tbrand_name_taken')); focusFirstWrong(formRef.current); return }
                return showToast(apiErrorText(text, t('error_generic')), 'error')
            }
            showToast(t(brand ? 'tbrand_saved' : 'tbrand_added'), 'success')
            await onSaved()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open onClose={() => { if (!saving) onClose() }} title={brand ? t('tbrand_edit') : t('tbrand_add')} actions={<>
            <Button onClick={onClose} disabled={saving}>{t('cancel')}</Button>
            <Button type="submit" form={formId} variant="primary" busy={saving}>{t('save')}</Button>
        </>}>
            <form id={formId} ref={formRef} onSubmit={submit} className="ui-dialog-body" noValidate>
                <Field label={t('tbrand_name')} hint={t('tbrand_name_hint')} error={nameError}>{p => (
                    <TextInput {...p} name="name" value={name} maxLength={60} autoComplete="off" spellCheck={false} disabled={saving}
                        onChange={e => { setName(e.target.value); setNameError(undefined) }} />
                )}</Field>
                <Field label={t('tbrand_protocol')} hint={locked ? t('tbrand_protocol_locked') : t('tbrand_protocol_hint')}>{p => (
                    <Select {...p} name="protocol" value={protocol} disabled={saving || locked}
                        options={PROTOCOLS.map(v => ({ value: v, label: t(protocolKey(v)) }))}
                        onChange={e => setProtocol(e.target.value as Protocol)} />
                )}</Field>
                <Field label={t('tbrand_notes_en')} hint={t('tbrand_notes_hint')}>{p => (
                    <TextArea {...p} name="notesEn" lang="en" dir="ltr" rows={2} maxLength={500} value={notesEn} disabled={saving} onChange={e => setNotesEn(e.target.value)} />
                )}</Field>
                <Field label={t('tbrand_notes_ar')}>{p => (
                    <TextArea {...p} name="notesAr" lang="ar" dir="rtl" rows={2} maxLength={500} value={notesAr} disabled={saving} onChange={e => setNotesAr(e.target.value)} />
                )}</Field>
            </form>
        </Dialog>
    )
}
