'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { createPortal } from 'react-dom'
import ConfirmModal from '@/components/ConfirmModal'
import EmployeeFilter from '@/components/EmployeeFilter'
import LocationSearchInput from '@/components/LocationSearchInput'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import { fetcher } from '@/lib/swr-fetcher'

interface Vendor {
    id: string
    name: string
    ownerName: string
    mobileNumber: string
    locationName: string
    locationLink: string | null
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
    const [mounted, setMounted] = useState(false)
    const [isMobile, setIsMobile] = useState(false)

    const [isAddOpen, setIsAddOpen] = useState(false)
    const [addForm, setAddForm] = useState<VendorFormState>(emptyForm)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const [isEditOpen, setIsEditOpen] = useState(false)
    const [editForm, setEditForm] = useState<VendorFormState>(emptyForm)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [isEditing, setIsEditing] = useState(false)

    const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean, vendor: Vendor | null }>({ isOpen: false, vendor: null })

    const vendorsLabel = (session?.user as any)?.vendorsLabel || t('vendors')

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 1024)
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    useEffect(() => {
        setMounted(true)
    }, [])

    useEffect(() => {
        setTitle(vendorsLabel)
        setSubtitle(t('vendors_subtitle' as any))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setTitle, setSubtitle, vendorsLabel])

    // Super Admin manages vendors for whichever company they've picked via
    // the switcher — same pattern as Employees/Clients. No selection yet
    // means no fetch at all rather than a 400 from the API.
    const needsCompanySelection = userRole === 'SUPER_ADMIN' && !contextCompanyId
    const vendorsQuery = needsCompanySelection
        ? null
        : (userRole === 'SUPER_ADMIN' ? `/api/vendors?companyId=${contextCompanyId}` : '/api/vendors')
    const { data: vendorsResult, isLoading, mutate: mutateVendors } = useSWR(vendorsQuery, fetcher)
    const allVendors: Vendor[] = vendorsResult?.data || []
    const vendors = allVendors.filter(v =>
        v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.ownerName.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const canManage = ['ADMIN', 'SUPER_ADMIN'].includes(userRole)

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!addForm.name.trim() || !addForm.ownerName.trim() || !addForm.mobileNumber.trim() || !addForm.locationName.trim()) return

        setIsSubmitting(true)
        try {
            const payload: any = { ...addForm }
            if (userRole === 'SUPER_ADMIN') payload.companyId = contextCompanyId

            const res = await fetch('/api/vendors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            if (res.ok) {
                setAddForm(emptyForm)
                setIsAddOpen(false)
                mutateVendors()
                showToast(t('vendor_created_success' as any) || 'Vendor added', 'success')
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
                showToast(t('vendor_updated_success' as any) || 'Vendor updated', 'success')
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

    if (needsCompanySelection) {
        return (
            <div className="glass-card flex flex-col items-center justify-center py-16 text-center text-slate-500">
                <span className="text-5xl mb-4">🏢</span>
                <h3 className="text-xl font-bold text-slate-800">{t('select_company_prompt' as any) || 'Select a company to view its vendors'}</h3>
            </div>
        )
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
                            {t('add_vendor' as any) || `Add ${vendorsLabel}`}
                        </button>
                    ) : undefined}
                />

                {isLoading ? (
                    <LoadingSpinner message={t('loading_data')} />
                ) : vendors.length === 0 ? (
                    <div className="glass-card flex flex-col items-center justify-center py-16 text-center text-slate-500">
                        <span className="text-5xl mb-4">🚚</span>
                        <h3 className="text-xl font-bold text-slate-800">{t('no_vendors_found' as any) || 'No vendors found'}</h3>
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
                                        <div style={{ fontSize: '0.85rem', color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.75rem' }}>
                                            <span>👤 {vendor.ownerName}</span>
                                            <span>📞 {vendor.mobileNumber}</span>
                                            {vendor.locationLink ? (
                                                <a href={vendor.locationLink} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>
                                                    📍 {vendor.locationName}
                                                </a>
                                            ) : (
                                                <span>📍 {vendor.locationName}</span>
                                            )}
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
                                                    background: '#eff6ff', color: '#2563eb', padding: '0.4rem 0.85rem',
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
                                                    background: '#fef2f2', color: '#dc2626', padding: '0.4rem 0.85rem',
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
                    background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 9999
                }}>
                    <div className="absolute inset-0" onClick={() => !isSubmitting && setIsAddOpen(false)} />
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto', position: 'relative', zIndex: 10, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', color: '#1e293b' }}>
                            {t('add_vendor' as any) || `Add ${vendorsLabel}`}
                        </h2>
                        <form onSubmit={handleCreate}>
                            <VendorFormFields form={addForm} setForm={setAddForm} locale={locale} t={t} />
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                                <button type="button" onClick={() => setIsAddOpen(false)} style={{ padding: '0.75rem 1.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'transparent', cursor: 'pointer' }}>
                                    {t('cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting || !addForm.name.trim() || !addForm.ownerName.trim() || !addForm.mobileNumber.trim() || !addForm.locationName.trim()}
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
                    background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 9999
                }}>
                    <div className="absolute inset-0" onClick={() => !isEditing && setIsEditOpen(false)} />
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto', position: 'relative', zIndex: 10, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', color: '#1e293b' }}>
                            {t('edit_vendor' as any) || `Edit ${vendorsLabel}`}
                        </h2>
                        <form onSubmit={handleEdit}>
                            <VendorFormFields form={editForm} setForm={setEditForm} locale={locale} t={t} />
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                                <button type="button" onClick={() => setIsEditOpen(false)} style={{ padding: '0.75rem 1.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'transparent', cursor: 'pointer' }}>
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
                title={t('delete_vendor_title' as any) || `Delete ${vendorsLabel}`}
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
    const labelStyle: React.CSSProperties = { display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }
    const inputStyle: React.CSSProperties = { width: '100%', padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }

    return (
        <>
            <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>{t('vendor_name' as any) || 'Vendor name'}</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" style={inputStyle} autoFocus />
            </div>
            <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>{t('vendor_owner_name' as any) || 'Owner name'}</label>
                <input type="text" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} className="input" style={inputStyle} />
            </div>
            <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>{t('vendor_mobile_number' as any) || 'Mobile number'}</label>
                <input type="tel" value={form.mobileNumber} onChange={(e) => setForm({ ...form, mobileNumber: e.target.value })} className="input" style={inputStyle} />
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
