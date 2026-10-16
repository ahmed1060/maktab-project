'use client'

import { useId, useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { StorefrontIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useCompany } from '@/context/CompanyContext'
import { Button, Dialog, EmptyState, Field, Select } from '@/components/ui'
import { fetcher } from '@/lib/swr-fetcher'

type Client = { id: string; name: string; company?: string }

/**
 * Adding a record from the Records page (CLIENTS_PLAN.md §0.2): which client
 * it's for, and then that client's page, where the form opens with its
 * sections. Someone who may add records but not see the vendors list, as an
 * ordinary employee, reaches a client without records yet this way.
 */
export default function ClientPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
    if (!open) return null
    return <Picker onClose={onClose} />
}

function Picker({ onClose }: { onClose: () => void }) {
    const { t } = useLanguage()
    const router = useRouter()
    const { selectedCompanyId } = useCompany()
    const formId = useId()
    const url = `/api/records/clients${selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : ''}`
    const { data, error, isLoading, mutate } = useSWR<{ data: Client[] }>(url, fetcher)
    const clients = data?.data ?? []
    const [chosen, setChosen] = useState('')
    const clientId = chosen || clients[0]?.id || ''

    const go = (e: React.FormEvent) => {
        e.preventDefault()
        if (clientId) router.push(`/dashboard/vendors/${encodeURIComponent(clientId)}?add=1`)
    }

    return (
        <Dialog
            open
            onClose={onClose}
            title={t('records_add')}
            actions={<>
                <Button onClick={onClose}>{t('cancel')}</Button>
                <Button type="submit" form={formId} variant="primary" disabled={!clientId}>{t('records_continue')}</Button>
            </>}
        >
            <form id={formId} onSubmit={go} className="ui-dialog-body" noValidate>
                {error
                    ? <EmptyState icon={WarningCircleIcon} title={t('records_vendors_failed')} action={<Button onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    : isLoading && !data
                        ? <p className="ui-hint" role="status">{t('loading')}</p>
                        : clients.length === 0
                            ? <EmptyState icon={StorefrontIcon} title={t('records_no_vendors')} />
                            : (
                                <Field label={t('records_col_vendor')} hint={t('records_pick_vendor_hint')}>{p => (
                                    <Select
                                        {...p}
                                        value={clientId}
                                        onChange={e => setChosen(e.target.value)}
                                        options={clients.map(c => ({ value: c.id, label: c.company ? `${c.name} · ${c.company}` : c.name }))}
                                    />
                                )}</Field>
                            )}
            </form>
        </Dialog>
    )
}
