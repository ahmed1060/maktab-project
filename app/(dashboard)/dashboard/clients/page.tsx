'use client'

import { useId, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import {
    BuildingsIcon, HourglassIcon, MapPinIcon, PencilSimpleIcon, PhoneIcon, PlusIcon, StorefrontIcon, TrashIcon, UserIcon, WarningCircleIcon,
} from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import ConfirmModal from '@/components/ConfirmModal'
import PlaceFields from '@/components/locations/PlaceFields'
import {
    Button, DataList, Dialog, EmptyState, Field, FilterBar, ItemTitle, ListCard, Page, PageHeader, Pager, pageInRange, RowMenu, SearchInput, Select, TextInput,
    type Column, type MenuItem,
} from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import { fetcher } from '@/lib/swr-fetcher'
import { useModules } from '@/lib/useModules'
import { useCan } from '@/lib/useCan'
import { countOf } from '@/lib/plural'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { draftOf, pinOfLink, readPlace, emptyPlace, type PlaceDraft, type PlaceErrors } from '@/lib/place-draft'

interface Client {
    id: string
    name: string
    ownerName: string
    mobileNumber: string
    locationName: string
    locationLink: string | null
    /** Its HQ, if it has one yet. */
    locations: { id: string; name: string; latitude: number | null; longitude: number | null; radiusMeters: number | null }[]
    company?: { name: string }
    createdBy: { firstName: string, lastName: string } | null
}

type ClientFormState = {
    name: string
    ownerName: string
    mobileNumber: string
}

const emptyForm: ClientFormState = { name: '', ownerName: '', mobileNumber: '' }
const LIMIT = 20

/** Whether a form has the details a client needs; its HQ is checked when it's saved. */
const complete = (f: ClientFormState) => !!(f.name.trim() && f.ownerName.trim() && f.mobileNumber.trim())

/**
 * A client's HQ in its form: the HQ it has, or, for one the release before
 * added, its own location fields, with the pin from its map link if it has
 * one there.
 */
function hqDraft(c: Client): PlaceDraft {
    const hq = c.locations?.[0]
    if (hq) return draftOf(hq)
    return { name: c.locationName, point: pinOfLink(c.locationLink ?? '') ?? '', radius: '' }
}
const sameDraft = (a: PlaceDraft, b: PlaceDraft) => a.name === b.name && a.point === b.point && a.radius === b.radius

/**
 * The businesses the company works for (CLIENTS_PLAN.md §0.1), on the
 * building blocks (DESIGN.md §5): search, a table on computers and cards on
 * phones, and adding, editing and deleting one, for whoever may manage them.
 * Each client's own page holds its records (§0.2).
 */
export default function ClientsPage() {
    const { data: session } = useSession()
    const superAdmin = (session?.user as { role?: string } | undefined)?.role === 'SUPER_ADMIN'
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { selectedCompanyId } = useCompany()
    const modules = useModules()
    // The company's own name for its clients, if it has one: what the page's
    // buttons and messages say then, as a translated label would ignore it.
    const clientsName = modules.label('clients')
    const renamed = clientsName !== t('clients')
    const say = (key: 'clients_add' | 'clients_edit' | 'clients_delete' | 'clients_added' | 'clients_updated', ar: string, en: string) =>
        !renamed ? t(key) : locale === 'ar' ? ar.replace('{name}', clientsName) : en.replace('{name}', clientsName)
    const { can } = useCan()
    const sees = can('clients.view')
    const canManage = can('clients.manage')

    const [query, setQuery] = useState('')
    const [page, setPage] = useState(1)
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<Client | null>(null)
    const [toDelete, setToDelete] = useState<Client | null>(null)

    // A Super Admin who hasn't picked a company sees every company's clients,
    // each with its company named: names are only unique within a company.
    const everyCompany = superAdmin && !selectedCompanyId
    const listUrl = superAdmin && selectedCompanyId ? `/api/clients?companyId=${encodeURIComponent(selectedCompanyId)}` : '/api/clients'
    const { data: result, error, isLoading, isValidating, mutate } = useSWR<{ data: Client[] }>(sees ? listUrl : null, fetcher)
    const failed = !result && !!error
    const all = result?.data ?? []
    const search = query.trim().toLowerCase()
    const matching = search ? all.filter(c => c.name.toLowerCase().includes(search) || c.ownerName.toLowerCase().includes(search)) : all
    const pageCount = Math.ceil(matching.length / LIMIT)
    const clients = matching.slice((page - 1) * LIMIT, page * LIMIT)

    useAdjustOnChange([search], () => setPage(1))
    useAdjustOnChange([pageCount], () => setPage(p => pageInRange(p, pageCount)))
    // Another company picked: what's open belongs to the last one, and Save
    // or Delete would still act on it.
    useAdjustOnChange([selectedCompanyId], () => { setPage(1); setAdding(false); setEditing(null); setToDelete(null) })

    const confirmDelete = async () => {
        if (!toDelete) return
        try {
            const res = await fetch(`/api/clients?id=${encodeURIComponent(toDelete.id)}`, { method: 'DELETE' })
            if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                showToast(body.error || t('error_generic'), 'error')
                return
            }
            void mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setToDelete(null)
        }
    }

    const addedBy = (c: Client) => c.createdBy ? `${c.createdBy.firstName} ${c.createdBy.lastName}` : t('role_super_admin')
    // Its own page holds its records (CLIENTS_PLAN.md §0.2).
    const name = (c: Client) => <Link href={`/dashboard/clients/${c.id}`} prefetch={false} className="ui-item-link"><bdi>{c.name}</bdi></Link>
    const phone = (c: Client) => <a href={`tel:${c.mobileNumber.replace(/[^0-9+]/g, '')}`} className="ui-item-link"><bdi>{c.mobileNumber}</bdi></a>
    const place = (c: Client) => c.locationLink
        ? <a href={c.locationLink} target="_blank" rel="noopener noreferrer" className="ui-item-link"><bdi>{c.locationName}</bdi><span className="ui-visually-hidden"> {t('ui_opens_new_tab')}</span></a>
        : <bdi>{c.locationName}</bdi>
    const menu = (c: Client): MenuItem[] => [
        { key: 'edit', label: t('edit'), icon: PencilSimpleIcon, onSelect: () => setEditing(c) },
        { key: 'delete', label: t('delete'), icon: TrashIcon, danger: true, onSelect: () => setToDelete(c) },
    ]
    const actions = (c: Client) => canManage && (
        <span className="ui-row-actions">
            <RowMenu label={t('ui_more_actions_for').replace('{name}', c.name)} tooltip={t('ui_more_actions')} items={menu(c)} />
        </span>
    )

    const columns: Column<Client>[] = [
        { key: 'client', header: t('clients_col_client'), cell: c => <ItemTitle title={name(c)} detail={<bdi>{c.ownerName}</bdi>} detailIcon={UserIcon} /> },
        ...(everyCompany ? [{ key: 'company', header: t('clients_col_company'), cell: (c: Client) => <bdi>{c.company?.name}</bdi> }] : []),
        { key: 'phone', header: t('clients_col_phone'), cell: phone },
        { key: 'location', header: t('clients_col_location'), cell: place },
        { key: 'added', header: t('clients_col_added'), cell: c => <span className="ui-item-detail">{addedBy(c)}</span> },
        ...(canManage ? [{ key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end' as const, cell: actions }] : []),
    ]

    const addLabel = say('clients_add', 'إضافة {name}', 'Add {name}')
    const empty = failed
        ? <EmptyState icon={WarningCircleIcon} title={t('clients_load_failed')} action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
        : search
            ? <EmptyState icon={StorefrontIcon} title={t('clients_none_found')} action={<Button variant="quiet" onClick={() => setQuery('')}>{t('ui_reset_filters')}</Button>} />
            : <EmptyState icon={StorefrontIcon} title={t('clients_none')} action={canManage ? <Button variant="primary" icon={PlusIcon} onClick={() => setAdding(true)}>{addLabel}</Button> : undefined} />

    // Once the session is known: before it loads nobody holds anything. Not
    // "didn't load", which Try again would never fix.
    if (session?.user && !sees) return <AccessDenied />

    return (
        <Page>
            <PageHeader
                title={clientsName}
                subtitle={t('clients_subtitle')}
                action={canManage && <Button variant="primary" icon={PlusIcon} onClick={() => setAdding(true)}>{addLabel}</Button>}
            />

            <FilterBar
                search={<Field label={t('clients_search')} hideLabel>{p => <SearchInput {...p} autoComplete="off" placeholder={t('clients_search')} value={query} onChange={e => setQuery(e.target.value)} />}</Field>}
                onReset={query ? () => setQuery('') : undefined}
            />

            {/* Loading, too, until the session says who's looking: before it, nobody
                holds anything and nothing is asked for, which isn't "none". */}
            {!session?.user || (isLoading && !result)
                ? <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('clients_loading')} /></div>
                : (
                    <DataList
                        caption={clientsName}
                        columns={columns}
                        rows={failed ? [] : clients}
                        rowKey={c => c.id}
                        card={c => (
                            <ListCard
                                title={name(c)}
                                details={[
                                    { icon: UserIcon, text: <bdi>{c.ownerName}</bdi> },
                                    { icon: PhoneIcon, text: phone(c) },
                                    { icon: MapPinIcon, text: place(c) },
                                    ...(everyCompany && c.company ? [{ icon: BuildingsIcon, text: <bdi>{c.company.name}</bdi> }] : []),
                                ]}
                                foot={<><span className="ui-item-detail">{addedBy(c)}</span>{actions(c)}</>}
                            />
                        )}
                        footer={<Pager page={page} pageCount={pageCount} onPage={setPage} summary={countOf(t, locale, matching.length, 'clients')} />}
                        empty={empty}
                    />
                )}

            {adding && (
                <ClientForm
                    title={addLabel}
                    // With no company picked, a Super Admin says which it's for.
                    pickCompany={everyCompany}
                    companyId={superAdmin ? selectedCompanyId ?? undefined : undefined}
                    onClose={() => setAdding(false)}
                    onSaved={() => {
                        setAdding(false)
                        void mutate()
                        showToast(say('clients_added', 'تمت إضافة {name}', '{name} added'), 'success')
                    }}
                />
            )}
            {editing && (
                <ClientForm
                    title={say('clients_edit', 'تعديل {name}', 'Edit {name}')}
                    client={editing}
                    onClose={() => setEditing(null)}
                    onSaved={() => {
                        setEditing(null)
                        void mutate()
                        showToast(say('clients_updated', 'تم تحديث {name}', '{name} updated'), 'success')
                    }}
                />
            )}
            <ConfirmModal
                isOpen={!!toDelete}
                title={say('clients_delete', 'حذف {name}', 'Delete {name}')}
                message={`${t('delete_client_warning')} ${toDelete?.name ?? ''}?`}
                confirmText={t('delete')}
                cancelText={t('cancel')}
                onConfirm={confirmDelete}
                onCancel={() => setToDelete(null)}
                variant="danger"
            />
        </Page>
    )
}

/**
 * Adding a client, or editing one: a dialog with its details and its HQ
 * (CLIENTS_PLAN.md §2.4), mounted afresh each time it opens. An edit leaves
 * the HQ as it is unless it's changed here, so a client whose HQ has no pin
 * yet can still have its phone number corrected.
 */
function ClientForm({ title, client, pickCompany = false, companyId, onClose, onSaved }: {
    title: string
    /** The client edited; none to add one. */
    client?: Client
    /** Ask which company it's for: a Super Admin who hasn't picked one. */
    pickCompany?: boolean
    /** The company a Super Admin has picked, which it's added to. */
    companyId?: string
    onClose: () => void
    onSaved: () => void
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const formId = useId()
    const formRef = useRef<HTMLFormElement>(null)
    const [form, setForm] = useState<ClientFormState>(client
        ? { name: client.name, ownerName: client.ownerName, mobileNumber: client.mobileNumber }
        : emptyForm)
    const [opened] = useState<PlaceDraft>(() => (client ? hqDraft(client) : emptyPlace))
    const [hq, setHq] = useState<PlaceDraft>(opened)
    const [hqErrors, setHqErrors] = useState<PlaceErrors>({})
    const [tried, setTried] = useState(false)
    const [chosenCompany, setChosenCompany] = useState('')
    const [saving, setSaving] = useState(false)
    const { data: companiesBody } = useSWR(pickCompany ? '/api/companies?limit=1000' : null, fetcher)
    const companies: { id: string, name: string }[] = (() => {
        const raw = companiesBody?.data?.data || companiesBody?.data || companiesBody
        return Array.isArray(raw) ? raw : []
    })()
    const ready = complete(form) && (!pickCompany || !!chosenCompany)

    const save = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!ready || saving) return
        // A new client's HQ, or one changed here.
        const sendsHq = !client || !sameDraft(hq, opened)
        const { place, errors } = sendsHq ? readPlace(hq) : { place: null, errors: {} }
        setHqErrors(errors)
        setTried(true)
        if (sendsHq && !place) {
            // To the first field that needs fixing, once it's marked.
            requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
            return
        }
        setSaving(true)
        try {
            const details = { ...form, ...(place ? { hq: place } : {}) }
            const res = await fetch('/api/clients', {
                method: client ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(client
                    ? { id: client.id, ...details }
                    : { ...details, ...(pickCompany ? { companyId: chosenCompany } : companyId ? { companyId } : {}) }),
            })
            if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                showToast(body.error || t('error_generic'), 'error')
                return
            }
            onSaved()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    const set = (key: keyof ClientFormState) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value }))

    return (
        <Dialog
            open
            onClose={() => { if (!saving) onClose() }}
            title={title}
            actions={<>
                <Button onClick={onClose} disabled={saving}>{t('cancel')}</Button>
                <Button type="submit" form={formId} variant="primary" busy={saving} disabled={!ready}>{client ? t('save') : t('create')}</Button>
            </>}
        >
            <form ref={formRef} id={formId} onSubmit={save} className="ui-dialog-body" noValidate>
                {pickCompany && (
                    <Field label={t('select_company')}>{p => (
                        <Select {...p} icon={BuildingsIcon} value={chosenCompany} onChange={e => setChosenCompany(e.target.value)} disabled={saving}
                            options={[{ value: '', label: t('select_company') }, ...companies.map(c => ({ value: c.id, label: c.name }))]} />
                    )}</Field>
                )}
                {/* Names keep their own direction, whichever language the page is in
                    (DESIGN.md §7). None is filled in by the browser: it would offer the
                    person's own name and phone, not the client's. */}
                <Field label={t('client_name')}>{p => <TextInput {...p} name="name" autoComplete="off" dir="auto" value={form.name} onChange={set('name')} disabled={saving} />}</Field>
                <Field label={t('client_owner_name')}>{p => <TextInput {...p} name="ownerName" autoComplete="off" dir="auto" value={form.ownerName} onChange={set('ownerName')} disabled={saving} />}</Field>
                {/* A phone number reads left to right in either language (DESIGN.md §3.3). */}
                <Field label={t('client_mobile_number')}>{p => <TextInput {...p} name="mobileNumber" type="tel" autoComplete="off" dir="ltr" value={form.mobileNumber} onChange={set('mobileNumber')} disabled={saving} />}</Field>
                <PlaceFields
                    draft={hq}
                    onChange={d => { setHq(d); if (tried) setHqErrors(readPlace(d).errors) }}
                    errors={hqErrors}
                    nameLabel={t('client_hq')}
                    nameHint={t('client_hq_hint')}
                    disabled={saving}
                />
            </form>
        </Dialog>
    )
}
