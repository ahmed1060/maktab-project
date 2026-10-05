/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { useCompany } from '@/context/CompanyContext'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import Modal from '@/components/Modal'
import { useToast } from '@/context/ToastContext'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import Pagination from '@/components/Pagination'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useHeader } from '@/context/HeaderContext'
import { fetcher } from '@/lib/swr-fetcher'
import SubscriptionBadge from '@/components/SubscriptionBadge'
import SegmentedToggle from '@/components/SegmentedToggle'
import { bundleLabelKeys } from '@/lib/subscription-display'
import type { SubscriptionState, TrialPreset } from '@/lib/billing/state'
import { DEFAULT_TRIAL_PRESET, computeTrialEnd, TRIAL_PRESETS } from '@/lib/billing/state'
import { TRIAL_PRESET_LABEL_KEY } from '@/lib/subscription-display'
import NoticeModal, { Notice } from '@/components/NoticeModal'

type Company = {
    id: string
    name: string
    isBanned?: boolean
    package?: { id: string; name: string; hasCompanyManagement: boolean; hasHR: boolean; hasAttendanceTerminals?: boolean; hasAttendanceMobile?: boolean } | null
    hasUnpaidPayment?: boolean
    subscription?: { state: SubscriptionState; date: string | null; daysRemaining: number | null }
    needsAttention?: boolean
}

export default function CompaniesPage() {
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const router = useRouter()
    const [showModal, setShowModal] = useState(false)
    const [editingCompany, setEditingCompany] = useState<Company | null>(null)
    const [formData, setFormData] = useState<{ name: string; trialPreset: TrialPreset; packageId: string }>({
        name: '',
        // 14 days preselected: whichever option sits at the top of the list is
        // what gets chosen when nobody is thinking about it, and two days is a
        // demo, not a trial.
        trialPreset: DEFAULT_TRIAL_PRESET,
        packageId: '',
    })
    const [submitLoading, setSubmitLoading] = useState(false)
    const [error, setError] = useState('')
    const { triggerRefresh } = useCompany()

    const { data: session } = useSession()
    const userRole = session?.user?.role || ''

    const { data: packagesResult } = useSWR(userRole === 'SUPER_ADMIN' ? '/api/packages' : null, fetcher)
    const assignablePackages: { id: string; name: string }[] = packagesResult?.data || []

    // Delete State
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null)
    const [deletePasscode, setDeletePasscode] = useState('')
    const [deleteError, setDeleteError] = useState('')
    const { showToast } = useToast()
    const [isDeleting, setIsDeleting] = useState(false)
    const [banConfirm, setBanConfirm] = useState<{ isOpen: boolean, company: Company | null, action: 'ban' | 'unban' | null }>({ isOpen: false, company: null, action: null })
    // Replaces alert(): a native dialog ignores the palette entirely, and it
    // blocks the main thread for as long as it is up.
    const [notice, setNotice] = useState<Notice | null>(null)

    const [page, setPage] = useState(1)
    const limit = 10

    // On by default: this screen should open already answering the only
    // question worth asking on a Monday morning, rather than showing everybody
    // and leaving you to scan. One click clears it.
    const [filter, setFilter] = useState<'needs-attention' | 'all'>('needs-attention')
    const [sort, setSort] = useState<'name' | 'date'>('date')

    const { data: result, isLoading: loading, mutate: fetchCompanies } = useSWR(
        `/api/companies?page=${page}&limit=${limit}&filter=${filter}&sort=${sort}`,
        fetcher
    )
    const companies: Company[] = result?.data?.data || result?.data || []
    const totalPages: number = result?.data?.totalPages || result?.totalPages || 0
    const needsAttentionCount: number = result?.data?.needsAttentionCount ?? 0
    const totalCompanies: number = result?.data?.totalCompanies ?? 0

    // Changing either control re-pages from the top; staying on page 3 of a
    // list that just became four rows long shows an empty table.
    const changeFilter = (next: 'needs-attention' | 'all') => { setFilter(next); setPage(1) }
    const changeSort = (next: 'name' | 'date') => { setSort(next); setPage(1) }

    useEffect(() => {
        setTitle(t('companies'))
        setSubtitle(t('companies_subtitle' as any))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t])

    const handleOpenModal = (company?: Company) => {
        setError('')
        if (company) {
            setEditingCompany(company)
            // Trial length is fixed at creation; editing only reassigns the
            // package. Extending a trial is its own action, not a field here.
            setFormData({ name: company.name, trialPreset: DEFAULT_TRIAL_PRESET, packageId: company.package?.id || '' })
        } else {
            setEditingCompany(null)
            setFormData({ name: '', trialPreset: DEFAULT_TRIAL_PRESET, packageId: '' })
        }
        setShowModal(true)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitLoading(true)
        setError('')

        try {
            const endpoint = '/api/companies'
            const method = editingCompany ? 'PUT' : 'POST'
            const body = editingCompany
                ? { id: editingCompany.id, name: formData.name }
                : { name: formData.name, trialPreset: formData.trialPreset, packageId: formData.packageId || null }

            const res = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || t('error_generic'))
            }

            if (editingCompany && (formData.packageId || '') !== (editingCompany.package?.id || '')) {
                await fetch(`/api/companies/${editingCompany.id}/package`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ packageId: formData.packageId || null }),
                })
            }

            // Success
            showToast(editingCompany ? t('company_updated_success') : t('company_created_success'), 'success')
            setShowModal(false)
            fetchCompanies()
            triggerRefresh()
        } catch (err: any) {
            if (err.message === 'Company already exists') {
                setError(t('error_company_exists'))
            } else {
                setError(err.message)
            }
        } finally {
            setSubmitLoading(false)
        }
    }

    const openDeleteModal = (company: Company) => {
        setCompanyToDelete(company)
        setDeletePasscode('')
        setDeleteError('')
        setShowDeleteModal(true)
    }

    const handleDelete = async (e: React.FormEvent) => {
        e.preventDefault()
        if (deletePasscode !== '2025') {
            setDeleteError(t('invalid_passcode'))
            return
        }

        if (!companyToDelete) return

        setIsDeleting(true)
        setDeleteError('')

        try {
            const res = await fetch(`/api/companies?id=${companyToDelete.id}`, { method: 'DELETE' })
            const data = await res.json()

            if (!res.ok) throw new Error(data.error || t('error_generic'))

            showToast(t('company_deleted_success'), 'success')
            setShowDeleteModal(false)
            setCompanyToDelete(null)
            fetchCompanies()
            triggerRefresh()
        } catch (err: any) {
            setDeleteError(err.message)
        } finally {
            setIsDeleting(false)
        }
    }

    if (userRole !== 'SUPER_ADMIN') {
        return <AccessDenied />
    }

    return (
        <>
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        {/* Both options visible with the selected one marked,
                            rather than one button that renames itself. A
                            self-renaming button cannot say what is selected and
                            what clicking would do at once, so it has to be
                            clicked to find out which reading was true. */}
                        <SegmentedToggle
                            ariaLabel={t('subscription_state' as any)}
                            value={filter}
                            onChange={changeFilter}
                            options={[
                                { value: 'needs-attention', label: t('needs_attention_filter' as any), count: needsAttentionCount },
                                { value: 'all', label: t('show_all_companies' as any), count: totalCompanies },
                            ]}
                        />

                        {/* "Sort by date | Sort by name" repeats the word in
                            both halves; the group's own label carries it once,
                            and the segments name only what differs. */}
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.82rem', color: 'var(--text-soft)', fontWeight: 500 }}>
                                {t('sort_label' as any)}
                            </span>
                            <SegmentedToggle
                                ariaLabel={t('sort_label' as any)}
                                value={sort}
                                onChange={changeSort}
                                options={[
                                    { value: 'date', label: t('date' as any) },
                                    { value: 'name', label: t('name_label' as any) },
                                ]}
                            />
                        </div>
                    </div>

                    <button
                        className="btn btn-primary"
                        onClick={() => handleOpenModal()}
                        style={{ height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem' }}
                    >
                        + {t('add_company')}
                    </button>
                </div>

                {loading ? <LoadingSpinner message={t('loading_companies')} /> : companies.length === 0 && filter === 'needs-attention' ? (
                    /* Said plainly, not as an empty table — an empty table reads
                       as a loading failure, and "nothing needs attention" is the
                       most valuable answer this screen can ever give. */
                    <div style={{ background: 'var(--surface)', borderRadius: '12px', boxShadow: '0 1px 3px var(--shadow-weak)', padding: '3rem 1.5rem', textAlign: 'center' }}>
                        <div aria-hidden="true" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</div>
                        <div style={{ fontWeight: 600, color: 'var(--ok-fg)', marginBottom: '0.75rem' }}>{t('nothing_needs_attention' as any)}</div>
                        <button className="btn btn-secondary" onClick={() => changeFilter('all')} style={{ fontSize: '0.85rem' }}>
                            {t('show_all_companies' as any)}
                        </button>
                    </div>
                ) : (
                    <div style={{ background: 'var(--surface)', borderRadius: '12px', overflowX: 'auto', boxShadow: '0 1px 3px var(--shadow-weak)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', direction: locale === 'ar' ? 'rtl' : 'ltr', minWidth: '800px' }}>
                            <thead style={{ background: 'var(--surface-subtle)', borderBottom: '1px solid var(--border)' }}>
                                <tr>
                                    <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('name_label')}</th>
                                    <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('subscription_state' as any)}</th>
                                    <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('bundles' as any)}</th>
                                    <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('status_label')}</th>
                                    <th style={{ textAlign: 'center', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('costs')}</th>
                                    <th style={{ textAlign: locale === 'ar' ? 'left' : 'right', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('quick_actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {companies.map(company => (
                                    <tr key={company.id} style={{ borderBottom: '1px solid var(--surface-sunk)', background: (company as any).isBanned ? 'var(--danger-bg-tint)' : 'var(--surface)' }}>
                                        <td style={{ padding: '1rem', fontWeight: '500', textAlign: locale === 'ar' ? 'right' : 'left' }}>{company.name}</td>
                                        <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            {company.subscription ? (
                                                <SubscriptionBadge
                                                    state={company.subscription.state}
                                                    date={company.subscription.date}
                                                    daysRemaining={company.subscription.daysRemaining}
                                                />
                                            ) : '—'}
                                            {company.hasUnpaidPayment && (
                                                <div style={{ marginTop: '0.3rem' }}>
                                                    <span style={{ padding: '0.15rem 0.45rem', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 600, background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>
                                                        {t('unpaid_record' as any)}
                                                    </span>
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            {/* How you read your own book of business: who is on
                                                Company Management alone and could be sold HR. */}
                                            {!company.package ? (
                                                <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>{t('no_package' as any)}</span>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}>
                                                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-body)' }}>{company.package.name}</span>
                                                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                                                        {bundleLabelKeys(company.package).length === 0 ? (
                                                            <span style={{ padding: '0.15rem 0.45rem', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 600, background: 'var(--surface-sunk)', color: 'var(--text-muted)' }}>
                                                                {t('core_only' as any)}
                                                            </span>
                                                        ) : bundleLabelKeys(company.package).map(key => (
                                                            <span key={key} style={{
                                                                padding: '0.15rem 0.45rem', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 600,
                                                                background: key === 'bundle_hr' ? 'var(--ok-bg)' : 'var(--info-bg)',
                                                                color: key === 'bundle_hr' ? 'var(--ok-fg)' : 'var(--info-fg)',
                                                            }}>
                                                                {t(key as any)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            {(company as any).isBanned ? (
                                                <span style={{ background: 'var(--danger-bg)', color: 'var(--danger-solid-hover)', padding: '0.25rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold' }}>{t('status_banned')}</span>
                                            ) : (
                                                <span style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)', padding: '0.25rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold' }}>{t('status_active')}</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                                            <button
                                                onClick={() => router.push(`/dashboard/companies/${company.id}/payments`)}
                                                className="btn"
                                                style={{
                                                    background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
                                                    color: 'var(--brand-primary-text)',
                                                    padding: '0.4rem 0.8rem',
                                                    fontSize: '0.8rem',
                                                    border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)'
                                                }}
                                            >
                                                <span aria-hidden="true">💳</span> {t('payments_history')}
                                            </button>
                                        </td>
                                        <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end' }}>
                                                {/* Icon-only, and in the row-actions group rather than next to
                                                    Payments History — it's a different concern (company policy,
                                                    not billing), so it reads as "manage this company" alongside
                                                    Edit/Ban/Delete instead of looking bundled with Payments. */}
                                                <button aria-label={t('company_settings_title') || 'Settings'}
                                                    // Navigates, and nothing else. It used to set the global
                                                    // company scope on the way, so that Vendors and Tasks —
                                                    // which read only the switcher — would follow you into the
                                                    // company you had just opened. That traded a navigation
                                                    // problem for a persistent one: setSelectedCompanyId writes
                                                    // a year-long cookie and localStorage, so one click on a
                                                    // gear silently re-scoped the whole product until somebody
                                                    // changed it back by hand. It also made this the only one
                                                    // of five row actions with a global side effect — Payments
                                                    // is reached by id in exactly the same way and never did
                                                    // this. Which company you are editing is answered on the
                                                    // settings page itself instead.
                                                    onClick={() => router.push(`/dashboard/companies/${company.id}/settings`)}
                                                    className="btn"
                                                    title={t('company_settings_title') || 'Settings'}
                                                    style={{
                                                        background: 'color-mix(in srgb, var(--ok-fg-deep) 10%, transparent)',
                                                        color: 'var(--ok-fg)',
                                                        padding: '0.4rem 0.6rem',
                                                        fontSize: '0.9rem',
                                                        border: '1px solid color-mix(in srgb, var(--ok-fg-deep) 20%, transparent)'
                                                    }}
                                                >
                                                    <span aria-hidden="true">⚙️</span>
                                                </button>
                                                <button
                                                    onClick={() => handleOpenModal(company)}
                                                    className="btn"
                                                    style={{ background: 'var(--surface-sunk)', color: 'var(--text-strong)', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                                                >
                                                    {t('edit')}
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setBanConfirm({
                                                            isOpen: true,
                                                            company,
                                                            action: (company as any).isBanned ? 'unban' : 'ban'
                                                        })
                                                    }}
                                                    className="btn"
                                                    style={{
                                                        background: (company as any).isBanned ? 'var(--ok-bg)' : 'var(--danger-bg)',
                                                        color: (company as any).isBanned ? 'var(--ok-fg)' : 'var(--danger-fg-strong)',
                                                        padding: '0.4rem 0.8rem',
                                                        fontSize: '0.8rem',
                                                    }}
                                                >
                                                    {(company as any).isBanned ? t('unban_company') : t('ban_company')}
                                                </button>
                                                <button
                                                    onClick={() => openDeleteModal(company)}
                                                    className="btn"
                                                    style={{
                                                        background: 'var(--danger-bg)',
                                                        color: 'var(--danger-fg-strong)',
                                                        padding: '0.4rem 0.8rem',
                                                        fontSize: '0.8rem',
                                                    }}
                                                >
                                                    {t('delete')}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    onPageChange={(p) => setPage(p)}
                />

                <Modal
                    isOpen={showModal}
                    onClose={() => setShowModal(false)}
                    title={editingCompany ? t('edit_company_title') : t('add_company')}
                    hideFooter={true}
                >
                    <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                        {error && <div style={{ color: 'var(--danger-fg-strong)', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}

                        <form onSubmit={handleSubmit}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>{t('company_name_label')}</label>
                                <input aria-label={t('company_name_label')}
                                    className="input"
                                    required
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                                />
                            </div>

                            {/* Trial length is chosen once, at creation. Changing
                                it afterwards would move an end date somebody has
                                already been told — extending is a separate action. */}
                            {!editingCompany && (
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>{t('trial_length' as any)}</label>
                                    <select aria-label={t('trial_length' as any)}
                                        className="input"
                                        value={formData.trialPreset}
                                        onChange={e => setFormData({ ...formData, trialPreset: e.target.value as TrialPreset })}
                                        style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                                    >
                                        {TRIAL_PRESETS.map(preset => (
                                            <option key={preset} value={preset}>{t(TRIAL_PRESET_LABEL_KEY[preset] as any)}</option>
                                        ))}
                                    </select>

                                    {/* "1 month" is abstract; a date is checkable.
                                        Computed with the same helper the server
                                        uses — a preview computed a second way is a
                                        preview that can lie, and this is the only
                                        way a clamping surprise (31 January + 1
                                        month) gets noticed by you rather than by a
                                        customer. */}
                                    <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: 'var(--text-soft)' }}>
                                        {t('trial_ends_on' as any)}:{' '}
                                        <b style={{ color: 'var(--text-body)' }}>
                                            {computeTrialEnd(new Date(), formData.trialPreset, 0)
                                                ?.toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
                                        </b>
                                    </div>
                                </div>
                            )}

                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>{t('package_label' as any)}</label>
                                <select aria-label={t('package_label' as any)}
                                    className="input"
                                    value={formData.packageId}
                                    onChange={e => setFormData({ ...formData, packageId: e.target.value })}
                                    style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                                >
                                    {/* Empty means grandfathered — everything on,
                                        nothing gated. Spelled out rather than left
                                        as a blank line, because it is a choice with
                                        consequences, not the absence of one. */}
                                    <option value="">{t('no_package' as any)}</option>
                                    {assignablePackages.map(pkg => (
                                        <option key={pkg.id} value={pkg.id}>{pkg.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                                <button type="button" onClick={() => setShowModal(false)} className="btn" style={{ background: 'var(--border)', color: 'var(--text-strong)' }}>
                                    {t('cancel')}
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={submitLoading}>
                                    {submitLoading ? t('saving') : t('save')}
                                </button>
                            </div>
                        </form>
                    </div>
                </Modal>

                <Modal
                    isOpen={showDeleteModal}
                    onClose={() => setShowDeleteModal(false)}
                    title={t('delete_company_title')}
                    hideFooter={true}
                >
                    <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                        <p style={{ marginBottom: '1.5rem', color: 'var(--text-soft)' }}>
                            {t('delete_company_warning')} <strong>{companyToDelete?.name}</strong>?
                            <br /><br />
                            <span style={{ fontWeight: 'bold', color: 'var(--danger-solid-hover)' }}>{t('delete_company_critical_warning')}</span>
                        </p>

                        {deleteError && <div style={{ color: 'var(--danger-fg-strong)', marginBottom: '1rem', fontSize: '0.9rem' }}>{deleteError}</div>}

                        <form onSubmit={handleDelete}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>{t('enter_passcode_label')}</label>
                                <input aria-label={t('enter_passcode_label')}
                                    type="password"
                                    className="input"
                                    required
                                    placeholder={t('enter_passcode_placeholder')}
                                    value={deletePasscode}
                                    onChange={e => setDeletePasscode(e.target.value)}
                                    style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                                <button type="button" onClick={() => setShowDeleteModal(false)} className="btn" style={{ background: 'var(--border)', color: 'var(--text-strong)' }}>
                                    {t('cancel')}
                                </button>
                                <button type="submit" className="btn" disabled={isDeleting} style={{ background: 'var(--danger-fill-hover)', color: 'var(--text-on-accent)', padding: '0.75rem 1.5rem', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' }}>
                                    {isDeleting ? t('deleting') : t('delete_permanently')}
                                </button>
                            </div>
                        </form>
                    </div>
                </Modal>
            </div>

            <ConfirmModal
                isOpen={banConfirm.isOpen}
                title={banConfirm.action === 'ban' ? t('ban_company') : t('unban_company')}
                message={banConfirm.action === 'ban'
                    ? `${t('ban_warning')}${banConfirm.company?.name}${t('ban_warning_suffix')}`
                    : `${t('unban_warning')}${banConfirm.company?.name}${t('unban_warning_suffix')}`
                }
                confirmText={banConfirm.action === 'ban' ? t('ban_company') : t('unban_company')}
                onConfirm={async () => {
                    if (banConfirm.company) {
                        try {
                            const res = await fetch('/api/companies', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: banConfirm.company.id, isBanned: banConfirm.action === 'ban' })
                            })
                            if (res.ok) {
                                fetchCompanies()
                                setBanConfirm({ isOpen: false, company: null, action: null })
                            } else {
                                setNotice({ variant: 'error', title: t('failed_change_ban_status') })
                            }
                        } catch {
                            setNotice({ variant: 'error', title: t('error_changing_status') })
                        }
                    }
                }}
                onCancel={() => setBanConfirm({ isOpen: false, company: null, action: null })}
                variant={banConfirm.action === 'ban' ? 'danger' : 'warning'}
            />
            <NoticeModal notice={notice} onClose={() => setNotice(null)} />
        </>
    )
}
