'use client'

import { useId, useRef, useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { BuildingsIcon, StorefrontIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import { Button, Choice, Dialog, Field, Select } from '@/components/ui'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import { draftOf, emptyPlace, readPlace, type PlaceDraft, type PlaceErrors } from '@/lib/place-draft'
import PlaceFields from './PlaceFields'
import { useClientOptions } from './useClientOptions'
import type { LocationItem } from './types'

const SHARED = 'shared'

/**
 * From a task's form (CLIENTS_PLAN.md §2.4): the task's client, if it has
 * one, which the new location is that client's unless it's made shared, and
 * the company a Super Admin is making the task in.
 */
export type ForTask = { clientId: string | null; clientName?: string; companyId?: string | null }

/**
 * Adding a location, or editing one (CLIENTS_PLAN.md §2.4): its name, its
 * pin and its check radius. On the Locations page, whose it is is chosen
 * here first: a client's, or shared. From a task's form, it's the task
 * client's, or shared. A client's first location is its HQ. A location
 * stays with the client it was added to.
 */
export default function LocationForm({ open, onClose, clientId, location, forTask, onSaved }: {
    open: boolean
    onClose: () => void
    /** The client it's added to; none to choose here, on the Locations page. */
    clientId?: string
    /** The location being edited; none to add one. */
    location?: LocationItem | null
    /** Added from a task's form. */
    forTask?: ForTask
    /** Once it's saved, with what was saved. */
    onSaved: (saved?: LocationItem) => void
}) {
    // Mounted afresh each time it opens, so it starts from the location as it is.
    if (!open) return null
    return <Form onClose={onClose} clientId={clientId} location={location ?? null} forTask={forTask} onSaved={onSaved} />
}

function Form({ onClose, clientId, location, forTask, onSaved }: {
    onClose: () => void
    clientId?: string
    location: LocationItem | null
    forTask?: ForTask
    onSaved: (saved?: LocationItem) => void
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const { can } = useCan()
    const { data: session } = useSession()
    const { selectedCompanyId } = useCompany()
    const formId = useId()
    const form = useRef<HTMLFormElement>(null)
    const editing = location !== null
    // On the Locations page: a client's, or shared. Without seeing the
    // clients, only a shared one.
    const choosing = !clientId && !editing && !forTask
    // From a task's form: its client's, unless made shared.
    const [taskShared, setTaskShared] = useState(false)
    const clients = useClientOptions(choosing && can('clients.view'))
    // Chosen each time, never Shared by default: a branch left on it would be no client's.
    const [chosen, setChosen] = useState('')
    const sharedChosen = chosen === SHARED || (choosing && !can('clients.view'))
    const forClient = forTask ? (taskShared ? '' : forTask.clientId ?? '') : clientId ?? (clients.clients.some(c => c.id === chosen) ? chosen : '')
    const [clientMissing, setClientMissing] = useState(false)
    // A shared location is a company's: a Super Admin who hasn't picked one says which.
    const superAdmin = (session?.user as { role?: string } | undefined)?.role === 'SUPER_ADMIN'
    const pickCompany = choosing && sharedChosen && superAdmin && !selectedCompanyId
    const [chosenCompany, setChosenCompany] = useState('')
    const { data: companiesBody } = useSWR(pickCompany ? '/api/companies?limit=1000' : null, fetcher)
    const companies: { id: string; name: string }[] = (() => {
        const raw = companiesBody?.data?.data || companiesBody?.data || companiesBody
        return Array.isArray(raw) ? raw : []
    })()

    const [draft, setDraft] = useState<PlaceDraft>(location ? draftOf(location) : emptyPlace)
    const [errors, setErrors] = useState<PlaceErrors>({})
    const [tried, setTried] = useState(false)
    const [saving, setSaving] = useState(false)
    // Not until the clients are known: a client's location would be added as a shared one.
    const ready = (!pickCompany || !!chosenCompany) && !clients.loading && !clients.failed

    const save = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!ready || saving) return
        const { place, errors: found } = readPlace(draft)
        const missing = choosing && !forClient && !sharedChosen
        setErrors(found)
        setClientMissing(missing)
        setTried(true)
        if (!place || missing) {
            // To the first field that needs fixing, once it's marked.
            requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
            return
        }
        setSaving(true)
        try {
            const company = pickCompany ? chosenCompany : superAdmin && !forClient ? (forTask ? forTask.companyId : selectedCompanyId) : null
            const res = await fetch('/api/locations', {
                method: editing ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editing
                    ? { id: location!.id, ...place }
                    : { ...place, clientId: forClient || null, ...(company ? { companyId: company } : {}) }),
            })
            const body = await res.json().catch(() => null)
            if (!res.ok) {
                showToast(body?.error || t('error_generic'), 'error')
                return
            }
            showToast(t(editing ? 'locations_updated' : 'locations_added'), 'success')
            onSaved(body?.data)
            onClose()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    const clientOptions = [
        { value: '', label: t('location_client_choose') },
        { value: SHARED, label: t('location_client_shared') },
        ...clients.clients.map(c => ({ value: c.id, label: c.company ? `${c.name} · ${c.company}` : c.name })),
    ]

    return (
        <Dialog
            open
            onClose={() => { if (!saving) onClose() }}
            title={t(editing ? 'locations_edit' : 'locations_add')}
            actions={<>
                <Button onClick={onClose} disabled={saving}>{t('cancel')}</Button>
                <Button type="submit" form={formId} variant="primary" busy={saving} disabled={!ready}>{t(editing ? 'save' : 'locations_add')}</Button>
            </>}
        >
            <form ref={form} id={formId} onSubmit={save} className="ui-dialog-body" noValidate>
                {choosing && can('clients.view') && (
                    clients.failed
                        ? (
                            <div className="ui-field">
                                <span className="ui-label">{t('location_client')}</span>
                                <span className="ui-error" role="alert">{t('records_clients_failed')}</span>
                                {/* Its own width, not the field's. */}
                                <div><Button busy={clients.retrying} onClick={clients.retry}>{t('try_again')}</Button></div>
                            </div>
                        )
                        : clients.loading
                            ? <p className="ui-hint" role="status">{t('loading')}</p>
                            : (
                                <Field label={t('location_client')} error={clientMissing ? t('location_client_required') : undefined}>{p => (
                                    <Select {...p} icon={StorefrontIcon} value={forClient || (chosen === SHARED ? SHARED : '')} onChange={e => { setChosen(e.target.value); setClientMissing(false) }} options={clientOptions} disabled={saving} />
                                )}</Field>
                            )
                )}
                {forTask && (forTask.clientId
                    ? (
                        <Choice
                            legend={t('location_whose')}
                            name="whose"
                            value={taskShared ? 'shared' : 'client'}
                            onChange={v => setTaskShared(v === 'shared')}
                            options={[
                                { value: 'client', label: <bdi>{t('location_for_client').replace('{name}', forTask.clientName ?? '')}</bdi>, disabled: saving },
                                { value: 'shared', label: t('location_client_shared'), disabled: saving },
                            ]}
                        />
                    )
                    : <p className="ui-hint">{t('location_task_shared_hint')}</p>
                )}
                {pickCompany && (
                    <Field label={t('select_company')}>{p => (
                        <Select {...p} icon={BuildingsIcon} value={chosenCompany} onChange={e => setChosenCompany(e.target.value)} disabled={saving}
                            options={[{ value: '', label: t('select_company') }, ...companies.map(c => ({ value: c.id, label: c.name }))]} />
                    )}</Field>
                )}
                <PlaceFields draft={draft} onChange={d => { setDraft(d); if (tried) setErrors(readPlace(d).errors) }} errors={errors} disabled={saving} />
            </form>
        </Dialog>
    )
}
