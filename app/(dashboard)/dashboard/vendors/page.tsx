'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { createPortal } from 'react-dom'
import ConfirmModal from '@/components/ConfirmModal'
import EmployeeFilter from '@/components/EmployeeFilter'
import LocationSearchInput from '@/components/LocationSearchInput'
import { useLanguage } from '@/context/LanguageContext'
import { useModules } from '@/lib/useModules'
import { useHeader } from '@/context/HeaderContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import { fetcher } from '@/lib/swr-fetcher'
import { useHydrated } from '@/lib/useHydrated'
import { useCan } from '@/lib/useCan'
import { useDialog } from '@/lib/useDialog'

interface Vendor {
    id: string
    name: string
    ownerName: string
    mobileNumber: string
    locationName: string
    locationLink: string | null
    company?: { name: string }
    createdBy: { firstName: string, lastName: string } | null
}

type VendorFormState = {
    name: string
    ownerName: string
    mobileNumber: string
    locationName: string
    locationLink: string
}

const emptyForm: VendorFormState = { name: '', ownerName: '', mobileNumber: '', locationName: '', locationLink: '' }

export default function VendorsPage() {
    const { data: session } = useSession()
    const userRole = (session?.user as any)?.role
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const { showToast } = useToast()
    const { selectedCompanyId: contextCompanyId } = useCompany()

    const [searchQuery, setSearchQuery] = useState('')
    const mounted = useHydrated()
    const [isMobile, setIsMobile] = useState(false)

    const [isAddOpen, setIsAddOpen] = useState(false)
    const [addForm, setAddForm] = useState<VendorFormState>(emptyForm)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const [isEditOpen, setIsEditOpen] = useState(false)
    const [editForm, setEditForm] = useState<VendorFormState>(emptyForm)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [isEditing, setIsEditing] = useState(false)
    const addDialog = useDialog(isAddOpen, () => !isSubmitting && setIsAddOpen(false))
    const editDialog = useDialog(isEditOpen, () => !isEditing && setIsEditOpen(false))

    const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean, vendor: Vendor | null }>({ isOpen: false, vendor: null })
    const [addFormCompanyId, setAddFormCompanyId] = useState('')

    const modules = useModules()
    const vendorsName = modules.label('vendors')

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 1024)
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])


    useEffect(() => {
        setTitle(vendorsName)
        setSubtitle(t('vendors_subtitle' as any))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setTitle, setSubtitle, vendorsName])

    // Super Admin manages vendors for whichever company they've picked via
    // the switcher — same pattern as Employees/Clients. No selection means
    // "all companies": an aggregate view (see the /api/vendors GET handler),
    // not an error — matches how Clients handles the same case.
    const isAllCompaniesView = userRole === 'SUPER_ADMIN' && !contextCompanyId
    const vendorsQuery = userRole === 'SUPER_ADMIN'
        ? (contextCompanyId ? `/api/vendors?companyId=${contextCompanyId}` : '/api/vendors')
        : '/api/vendors'
    const { data: vendorsResult, isLoading, mutate: mutateVendors } = useSWR(vendorsQuery, fetcher)
    const allVendors: Vendor[] = vendorsResult?.data || []
    const vendors = allVendors.filter(v =>
        v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.ownerName.toLowerCase().includes(searchQuery.toLowerCase())
    )

    // Only Super Admin ever sees the aggregate view, so only Super Admin
    // needs the full company list — for the Add form's company picker.
    const companiesQuery = isAllCompaniesView ? '/api/companies?limit=1000' : null
    const { data: companiesResult } = useSWR(companiesQuery, fetcher)
    const companiesForPicker: { id: string, name: string }[] = (() => {
        const raw = companiesResult?.data?.data || companiesResult?.data || companiesResult
        return Array.isArray(raw) ? raw : []
    })()

    const canManage = useCan().can('vendors.manage')

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!addForm.name.trim() || !addForm.ownerName.trim() || !addForm.mobileNumber.trim() || !addForm.locationName.trim()) return
        if (isAllCompaniesView && !addFormCompanyId) return

        setIsSubmitting(true)
        try {
            const payload: any = { ...addForm }
            if (userRole === 'SUPER_ADMIN') payload.companyId = contextCompanyId || addFormCompanyId

            const res = await fetch('/api/vendors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            if (res.ok) {
                setAddForm(emptyForm)
                setAddFormCompanyId('')
                setIsAddOpen(false)
                mutateVendors()
                showToast(locale === 'ar' ? `تمت إضافة ${vendorsName}` : `${vendorsName} added`, 'success')
            } else {
                const err = await res.json().catch(() => ({}))
                showToast(err.error || t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingId || !editForm.name.trim() || !editForm.ownerName.trim() || !editForm.mobileNumber.trim() || !editForm.locationName.trim()) return

        setIsEditing(true)
        try {
            const res = await fetch('/api/vendors', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: editingId, ...editForm })
            })

            if (res.ok) {
                setIsEditOpen(false)
                setEditingId(null)
                mutateVendors()
                showToast(locale === 'ar' ? `تم تحديث ${vendorsName}` : `${vendorsName} updated`, 'success')
            } else {
                const err = await res.json().catch(() => ({}))
                showToast(err.error || t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setIsEditing(false)
        }
    }

    return (
        <>
            <div className="space-y-6 animate-in fade-in duration-500">
                <EmployeeFilter
                    onFilterChange={(newFilters: any) => setSearchQuery(newFilters.search)}
                    selectedEmployeeId={''}
                    hideEmployeeFilter={true}
                    hideStatusFilter={true}
                    hideDateFilter={true}
                    hideFilterButton={true}
                    dateFrom={''}
                    dateTo={''}
                    selectedStatus={''}
                    searchQuery={searchQuery}
                    placeholder={locale === 'ar' ? 'بحث بالاسم' : 'Search name'}
                    totalCount={vendors.length}
                    primaryAction={canManage ? (
                        <button
                            onClick={() => setIsAddOpen(true)}
                            className="btn btn-primary"
                            style={{ height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem' }}
                        >
                            {/* Composed directly from the module's name, not a translation
                                key — "add_vendor" always says "Vendor" in the dictionary,
                                which would silently ignore a company's custom tab name. */}
                            {locale === 'ar' ? `إضافة ${vendorsName}` : `Add ${vendorsName}`}
                        </button>
                    ) : undefined}
                />

                {isLoading ? (
                    <LoadingSpinner message={t('loading_data')} />
                ) : vendors.length === 0 ? (
                    <div className="glass-card flex flex-col items-center justify-center py-16 text-center text-slate-500">
                        <span className="text-5xl mb-4">{modules.icon('vendors')}</span>
                        <h3 className="text-xl font-bold text-slate-800">
                            {locale === 'ar' ? `لا يوجد ${vendorsName}` : `No ${vendorsName} found`}
                        </h3>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {vendors.map((vendor, index) => (
                            <div
                                key={vendor.id}
                                className="glass-card hover:bg-white/60 transition-all duration-300 p-4 border border-white/40 shadow-sm relative overflow-hidden"
                                style={{
                                    animation: 'fadeIn 0.4s ease-out forwards',
                                    animationDelay: `${index * 50}ms`,
                                    marginBottom: '0.5rem'
                                }}
                            >
                                <div style={{
                                    display: 'flex',
                                    flexWrap: isMobile ? 'nowrap' : 'wrap',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    width: '100%',
                                    gap: isMobile ? '0.5rem' : '1rem'
                                }}>
                                    <div style={{
                                        flex: 1,
                                        minWidth: 0,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.25rem'
                                    }}>
                                        <h3 className="text-lg font-bold text-slate-800 leading-tight" style={{ margin: 0 }}>
                                            {vendor.name}
                                        </h3>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-soft)', display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.75rem' }}>
                                            {/* Only shown in the "all companies" view — vendor
                                                names are only unique per company, so two
                                                different companies can each have a vendor with
                                                the same name and there's nothing else on the
                                                card to tell them apart. */}
                                            {isAllCompaniesView && vendor.company?.name && (
                                                <span style={{ background: 'var(--surface-sunk)', color: 'var(--text-muted)', padding: '0.1rem 0.5rem', borderRadius: '9999px', fontWeight: 500 }}>
                                                    <span aria-hidden="true">🏢</span> {vendor.company.name}
                                                </span>
                                            )}
                                            <span><span aria-hidden="true">👤</span> {vendor.ownerName}</span>
                                            <span><span aria-hidden="true">📞</span> {vendor.mobileNumber}</span>
                                            {vendor.locationLink ? (
                                                <a href={vendor.locationLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info-fg)' }}>
                                                    <span aria-hidden="true">📍</span> {vendor.locationName}
                                                </a>
                                            ) : (
                                                <span><span aria-hidden="true">📍</span> {vendor.locationName}</span>
                                            )}
                                        </div>
                                        {/* createdBy is null for a Super-Admin-created
                                            vendor (the FK only targets User, not
                                            SuperAdmin) — shown generically rather than
                                            omitted, matching how the Audit Logs page
                                            already labels the same action there (with
                                            the actual Super Admin's name, since that
                                            page resolves it from the audit trail). */}
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: '0.1rem' }}>
                                            {t('vendor_created_by' as any) || 'Created by'}: {vendor.createdBy ? `${vendor.createdBy.firstName} ${vendor.createdBy.lastName}` : t('role_super_admin')}
                                        </div>
                                    </div>

                                    {canManage && (
                                        <div style={{
                                            display: 'flex',
                                            gap: '0.4rem',
                                            flex: '0 0 auto',
                                            width: isMobile ? '100%' : 'auto'
                                        }}>
                                            <button
                                                onClick={() => {
                                                    setEditingId(vendor.id)
                                                    setEditForm({
                                                        name: vendor.name,
                                                        ownerName: vendor.ownerName,
                                                        mobileNumber: vendor.mobileNumber,
                                                        locationName: vendor.locationName,
                                                        locationLink: vendor.locationLink || ''
                                                    })
                                                    setIsEditOpen(true)
                                                }}
                                                className="btn"
                                                style={{
                                                    background: 'var(--info-bg-subtle)', color: 'var(--info-solid-hover)', padding: '0.4rem 0.85rem',
                                                    fontSize: '0.8125rem', border: 'none', cursor: 'pointer',
                                                    whiteSpace: 'nowrap', flex: isMobile ? 1 : 'unset'
                                                }}
                                            >
                                                {t('edit')}
                                            </button>
                                            <button
                                                onClick={() => setDeleteConfirm({ isOpen: true, vendor })}
                                                className="btn"
                                                style={{
                                                    background: 'var(--danger-bg-subtle)', color: 'var(--danger-fg-strong)', padding: '0.4rem 0.85rem',
                                                    fontSize: '0.8125rem', border: 'none', cursor: 'pointer',
                                                    whiteSpace: 'nowrap', flex: isMobile ? 1 : 'unset'
                                                }}
                                            >
                                                {t('delete')}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {isAddOpen && mounted && createPortal(
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'var(--scrim)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 9999
                }}>
                    <div className="modal-backdrop" onClick={() => !isSubmitting && setIsAddOpen(false)} />
                    <div {...addDialog.panelProps} style={{ background: 'var(--surface)', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto', position: 'relative', zIndex: 10, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <h2 id={addDialog.titleId} style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', color: 'var(--text-main)' }}>
                            {locale === 'ar' ? `إضافة ${vendorsName}` : `Add ${vendorsName}`}
                        </h2>
                        <form onSubmit={handleCreate}>
                            {/* Only in the "all companies" view — with one company
                                already selected via the switcher, that's the only
                                sensible target and this would be redundant. */}
                            {isAllCompaniesView && (
                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        {t('select_company' as any) || 'Select Company'}
                                    </label>
                                    <select aria-label={t('select_company' as any) || 'Select Company'}
                                        value={addFormCompanyId}
                                        onChange={(e) => setAddFormCompanyId(e.target.value)}
                                        className="input"
                                        style={{ width: '100%', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                        autoFocus
                                    >
                                        <option value="">{t('select_company' as any) || 'Select Company'}</option>
                                        {companiesForPicker.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <VendorFormFields form={addForm} setForm={setAddForm} locale={locale} t={t} />
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                                <button type="button" onClick={() => setIsAddOpen(false)} style={{ padding: '0.75rem 1.5rem', border: '1px solid var(--border)', borderRadius: '0.5rem', background: 'transparent', cursor: 'pointer' }}>
                                    {t('cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting || !addForm.name.trim() || !addForm.ownerName.trim() || !addForm.mobileNumber.trim() || !addForm.locationName.trim() || (isAllCompaniesView && !addFormCompanyId)}
                                    className="btn btn-primary"
                                >
                                    {isSubmitting ? t('creating') : t('create' as any) || 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {isEditOpen && mounted && createPortal(
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'var(--scrim)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 9999
                }}>
                    <div className="modal-backdrop" onClick={() => !isEditing && setIsEditOpen(false)} />
                    <div {...editDialog.panelProps} style={{ background: 'var(--surface)', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto', position: 'relative', zIndex: 10, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <h2 id={editDialog.titleId} style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', color: 'var(--text-main)' }}>
                            {locale === 'ar' ? `تعديل ${vendorsName}` : `Edit ${vendorsName}`}
                        </h2>
                        <form onSubmit={handleEdit}>
                            <VendorFormFields form={editForm} setForm={setEditForm} locale={locale} t={t} />
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                                <button type="button" onClick={() => setIsEditOpen(false)} style={{ padding: '0.75rem 1.5rem', border: '1px solid var(--border)', borderRadius: '0.5rem', background: 'transparent', cursor: 'pointer' }}>
                                    {t('cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={isEditing || !editForm.name.trim() || !editForm.ownerName.trim() || !editForm.mobileNumber.trim() || !editForm.locationName.trim()}
                                    className="btn btn-primary"
                                >
                                    {isEditing ? t('saving') : t('save')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            <ConfirmModal
                isOpen={deleteConfirm.isOpen}
                title={locale === 'ar' ? `حذف ${vendorsName}` : `Delete ${vendorsName}`}
                message={`${t('delete_vendor_warning' as any) || 'Are you sure you want to delete'} ${deleteConfirm.vendor?.name}?`}
                confirmText={t('delete')}
                onConfirm={async () => {
                    if (deleteConfirm.vendor) {
                        try {
                            const res = await fetch(`/api/vendors?id=${deleteConfirm.vendor.id}`, { method: 'DELETE' })
                            if (res.ok) {
                                mutateVendors()
                                setDeleteConfirm({ isOpen: false, vendor: null })
                            } else {
                                const err = await res.json().catch(() => ({}))
                                showToast(err.error || t('error_generic'), 'error')
                            }
                        } catch {
                            showToast(t('error_generic'), 'error')
                        }
                    }
                }}
                onCancel={() => setDeleteConfirm({ isOpen: false, vendor: null })}
                variant="danger"
            />
        </>
    )
}

function VendorFormFields({ form, setForm, locale, t }: {
    form: VendorFormState
    setForm: (f: VendorFormState) => void
    locale: string
    t: (key: any) => string
}) {
    const labelStyle: React.CSSProperties = { display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }
    const inputStyle: React.CSSProperties = { width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }

    return (
        <>
            <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>{t('vendor_name' as any) || 'Vendor name'}</label>
                <input aria-label={t('vendor_name' as any) || 'Vendor name'} type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" style={inputStyle} autoFocus />
            </div>
            <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>{t('vendor_owner_name' as any) || 'Owner name'}</label>
                <input aria-label={t('vendor_owner_name' as any) || 'Owner name'} type="text" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} className="input" style={inputStyle} />
            </div>
            <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>{t('vendor_mobile_number' as any) || 'Mobile number'}</label>
                <input aria-label={t('vendor_mobile_number' as any) || 'Mobile number'} type="tel" value={form.mobileNumber} onChange={(e) => setForm({ ...form, mobileNumber: e.target.value })} className="input" style={inputStyle} />
            </div>
            <div style={{ marginBottom: '1rem' }}>
                <LocationSearchInput
                    label={t('vendor_location' as any) || 'Location'}
                    value={{ name: form.locationName, link: form.locationLink }}
                    onChange={(val) => setForm({ ...form, locationName: val.name, locationLink: val.link })}
                    placeholder={t('location_name_placeholder')}
                    locale={locale}
                />
            </div>
        </>
    )
}
