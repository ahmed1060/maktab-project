/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import Modal from '@/components/Modal'
import ConfirmModal from '@/components/ConfirmModal'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import { fetcher } from '@/lib/swr-fetcher'

type Pkg = {
    id: string
    name: string
    description: string | null
    isActive: boolean
    isPublic: boolean
    priceMonthly: number
    priceAnnual: number
    priceLifetime: number | null
    hasCompanyManagement: boolean
    hasHR: boolean
    _count?: { companies: number }
}

const EMPTY = {
    name: '',
    description: '',
    isActive: true,
    isPublic: true,
    priceMonthly: '',
    priceAnnual: '',
    priceLifetime: '',
    hasCompanyManagement: false,
    hasHR: false,
}

export default function PackagesPage() {
    const { t } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const { showToast } = useToast()
    const { data: session } = useSession()

    const [showModal, setShowModal] = useState(false)
    const [editing, setEditing] = useState<Pkg | null>(null)
    const [form, setForm] = useState<any>(EMPTY)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [toDelete, setToDelete] = useState<Pkg | null>(null)

    // Retired packages must stay visible here — deactivating only removes them
    // from the assignment dropdown, and a package you cannot see is one you
    // cannot bring back.
    const { data: result, isLoading, mutate } = useSWR('/api/packages?includeInactive=true', fetcher)
    const packages: Pkg[] = result?.data || []

    useEffect(() => {
        setTitle(t('packages' as any))
        return () => { setTitle(null); setSubtitle(null) }
    }, [t, setTitle, setSubtitle])

    if (session && session.user?.role !== 'SUPER_ADMIN') return <AccessDenied />

    const openCreate = () => {
        setEditing(null)
        setForm(EMPTY)
        setError('')
        setShowModal(true)
    }

    const openEdit = (pkg: Pkg) => {
        setEditing(pkg)
        setForm({
            name: pkg.name,
            description: pkg.description || '',
            isActive: pkg.isActive,
            isPublic: pkg.isPublic,
            priceMonthly: String(pkg.priceMonthly),
            priceAnnual: String(pkg.priceAnnual),
            // Empty is meaningful here: not sold as a lifetime purchase, which
            // is a different statement from sold for nothing.
            priceLifetime: pkg.priceLifetime === null ? '' : String(pkg.priceLifetime),
            hasCompanyManagement: pkg.hasCompanyManagement,
            hasHR: pkg.hasHR,
        })
        setError('')
        setShowModal(true)
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        setError('')

        const payload: any = {
            name: form.name.trim(),
            description: form.description.trim(),
            isActive: form.isActive,
            isPublic: form.isPublic,
            priceMonthly: Number(form.priceMonthly || 0),
            priceAnnual: Number(form.priceAnnual || 0),
            priceLifetime: form.priceLifetime === '' ? null : Number(form.priceLifetime),
            hasCompanyManagement: form.hasCompanyManagement,
            hasHR: form.hasHR,
        }
        if (editing) payload.id = editing.id

        try {
            const res = await fetch('/api/packages', {
                method: editing ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            const body = await res.json()
            if (!res.ok) {
                setError(body?.error || 'Failed to save package')
                return
            }
            showToast(editing ? t('package_updated_success' as any) : t('package_created_success' as any), 'success')
            setShowModal(false)
            mutate()
        } catch {
            setError('Failed to save package')
        } finally {
            setSaving(false)
        }
    }

    const confirmDelete = async () => {
        if (!toDelete) return
        const res = await fetch(`/api/packages?id=${toDelete.id}`, { method: 'DELETE' })
        const body = await res.json()
        if (!res.ok) {
            showToast(body?.error || 'Failed to delete package', 'error')
        } else {
            showToast(t('package_deleted_success' as any), 'success')
            mutate()
        }
        setToDelete(null)
    }

    const money = (n: number) => `$${n.toLocaleString()}`

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div />
                <button className="btn btn-primary" onClick={openCreate}>+ {t('add_package' as any)}</button>
            </div>

            {isLoading ? <LoadingSpinner /> : packages.length === 0 ? (
                <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-soft)' }}>
                    {t('no_packages_yet' as any)}
                </div>
            ) : (
                <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))' }}>
                    {packages.map(pkg => {
                        const companies = pkg._count?.companies ?? 0
                        return (
                            <div key={pkg.id} className="glass-card" style={{ padding: '1.25rem', opacity: pkg.isActive ? 1 : 0.6 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{pkg.name}</div>
                                        {pkg.description && (
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-soft)', marginTop: '0.25rem' }}>{pkg.description}</div>
                                        )}
                                    </div>
                                    {!pkg.isActive && (
                                        <span style={{ padding: '0.2rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600, background: 'var(--surface-sunk)', color: 'var(--text-soft)', whiteSpace: 'nowrap' }}>
                                            {t('package_retired' as any)}
                                        </span>
                                    )}
                                </div>

                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', margin: '0.85rem 0' }}>
                                    {!pkg.hasCompanyManagement && !pkg.hasHR && (
                                        <span style={{ padding: '0.2rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600, background: 'var(--surface-sunk)', color: 'var(--text-muted)' }}>
                                            {t('core_only' as any)}
                                        </span>
                                    )}
                                    {pkg.hasCompanyManagement && (
                                        <span style={{ padding: '0.2rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600, background: 'var(--info-bg)', color: 'var(--info-fg)' }}>
                                            {t('bundle_company_management' as any)}
                                        </span>
                                    )}
                                    {pkg.hasHR && (
                                        <span style={{ padding: '0.2rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600, background: 'var(--ok-bg)', color: 'var(--ok-fg)' }}>
                                            {t('bundle_hr' as any)}
                                        </span>
                                    )}
                                </div>

                                <div style={{ fontSize: '0.85rem', color: 'var(--text-body)', display: 'grid', gap: '0.2rem' }}>
                                    <div>{t('price_monthly' as any)}: <b>{money(pkg.priceMonthly)}</b></div>
                                    <div>{t('price_annual' as any)}: <b>{money(pkg.priceAnnual)}</b></div>
                                    <div>
                                        {t('price_lifetime' as any)}:{' '}
                                        <b>{pkg.priceLifetime === null ? <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>{t('not_sold_as_lifetime' as any)}</span> : money(pkg.priceLifetime)}</b>
                                    </div>
                                </div>

                                <div style={{ marginTop: '0.85rem', fontSize: '0.8rem', color: 'var(--text-soft)' }}>
                                    {t('companies_on_package' as any)}: <b style={{ color: 'var(--text-body)' }}>{companies}</b>
                                </div>

                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                                    <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => openEdit(pkg)}>
                                        {t('edit' as any)}
                                    </button>
                                    <button
                                        className="btn"
                                        style={{ flex: 1, opacity: companies > 0 ? 0.5 : 1, cursor: companies > 0 ? 'not-allowed' : 'pointer' }}
                                        disabled={companies > 0}
                                        title={companies > 0 ? t('package_delete_blocked' as any) : undefined}
                                        onClick={() => setToDelete(pkg)}
                                    >
                                        {t('delete' as any)}
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? t('edit_package' as any) : t('add_package' as any)}>
                <form onSubmit={submit} style={{ display: 'grid', gap: '0.9rem' }}>
                    {/* Stated before saving, not after. An edit reaches every
                        company on this package immediately — that warning is the
                        difference between deliberate repackaging and removing a
                        module from live customers mid-day. */}
                    {editing && (editing._count?.companies ?? 0) > 0 && (
                        <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'var(--warn-bg)', color: 'var(--warn-fg)', fontSize: '0.85rem', border: '1px solid var(--warn-border)' }}>
                            {t('package_edit_warning' as any).replace('{count}', String(editing._count?.companies ?? 0))}
                        </div>
                    )}

                    <div>
                        <label className="label">{t('package_name' as any)}</label>
                        <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required maxLength={80} />
                    </div>

                    <div>
                        <label className="label">{t('package_description' as any)}</label>
                        <textarea
                            className="input"
                            style={{ height: '70px', resize: 'none', lineHeight: 1.4 }}
                            value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })}
                            maxLength={500}
                        />
                    </div>

                    <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))' }}>
                        <div>
                            <label className="label">{t('price_monthly' as any)}</label>
                            <input className="input" type="number" min="0" step="0.01" value={form.priceMonthly} onChange={e => setForm({ ...form, priceMonthly: e.target.value })} required />
                        </div>
                        <div>
                            <label className="label">{t('price_annual' as any)}</label>
                            <input className="input" type="number" min="0" step="0.01" value={form.priceAnnual} onChange={e => setForm({ ...form, priceAnnual: e.target.value })} required />
                        </div>
                        <div>
                            <label className="label">{t('price_lifetime' as any)}</label>
                            <input className="input" type="number" min="0" step="0.01" placeholder={t('not_sold_as_lifetime' as any)} value={form.priceLifetime} onChange={e => setForm({ ...form, priceLifetime: e.target.value })} />
                        </div>
                    </div>

                    <div>
                        <label className="label">{t('bundles' as any)}</label>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.9rem' }}>
                                <input type="checkbox" checked={form.hasCompanyManagement} onChange={e => setForm({ ...form, hasCompanyManagement: e.target.checked })} />
                                {t('bundle_company_management' as any)}
                            </label>
                            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.9rem' }}>
                                <input type="checkbox" checked={form.hasHR} onChange={e => setForm({ ...form, hasHR: e.target.checked })} />
                                {t('bundle_hr' as any)}
                            </label>
                        </div>
                        {!form.hasCompanyManagement && !form.hasHR && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-soft)', marginTop: '0.4rem' }}>
                                {t('core_only' as any)}
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.9rem' }}>
                            <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />
                            {t('package_active' as any)}
                        </label>
                        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.9rem' }}>
                            <input type="checkbox" checked={form.isPublic} onChange={e => setForm({ ...form, isPublic: e.target.checked })} />
                            {t('package_public' as any)}
                        </label>
                    </div>

                    {error && <div style={{ color: 'var(--danger-fg-strong)', fontSize: '0.85rem' }}>{error}</div>}

                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                        <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>{t('cancel' as any)}</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '…' : t('save' as any)}</button>
                    </div>
                </form>
            </Modal>

            <ConfirmModal
                isOpen={!!toDelete}
                onCancel={() => setToDelete(null)}
                onConfirm={confirmDelete}
                variant="danger"
                title={t('delete' as any)}
                message={toDelete ? toDelete.name : ''}
            />
        </div>
    )
}
