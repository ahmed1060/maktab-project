'use client'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import DateTimePicker from '@/components/DateTimePicker'
import LocationSearchInput from '@/components/LocationSearchInput'
import { useHydrated } from '@/lib/useHydrated'
import { useNow } from '@/lib/useNow'
import { earliestDeadline } from '@/lib/deadline'

// F-23: extracted verbatim out of tasks/new/page.tsx, which had grown to
// 1386 lines. `bulkTasks`/`setBulkTasks` and `revalidateRow` stay owned by
// the parent page (handleBulkUpload populates bulkTasks from the parsed
// Excel file before this modal ever opens, and revalidateRow is reused
// there too) — only this modal's own per-cell editor-popup state moved in,
// since nothing outside this JSX ever reads it.
interface BulkTaskReviewModalProps {
    isOpen: boolean
    onClose: () => void
    bulkTasks: any[]
    setBulkTasks: (tasks: any[]) => void
    users: any[]
    vendors: any[]
    vendorsName: string
    revalidateRow: (task: any) => any
    isSubmitting: boolean
    setIsSubmitting: (v: boolean) => void
}

export default function BulkTaskReviewModal({
    isOpen, onClose, bulkTasks, setBulkTasks, users, vendors, vendorsName, revalidateRow, isSubmitting, setIsSubmitting
}: BulkTaskReviewModalProps) {
    const { t, locale } = useLanguage()
    // The deadline floor offered to the picker, kept current while the form
    // stays open. See lib/useNow.ts.
    const now = useNow()
    const { showToast } = useToast()
    const router = useRouter()

    const mounted = useHydrated()

    const [activeAssigneeEdit, setActiveAssigneeEdit] = useState<{ index: number, type: 'add' | 'remove' } | null>(null)
    const [activeCellEdit, setActiveCellEdit] = useState<{ index: number, field: 'title' | 'description' | 'deadline' } | null>(null)
    const [editAnchorRect, setEditAnchorRect] = useState<DOMRect | null>(null)
    const [assigneeSearch, setAssigneeSearch] = useState('')
    // Per-row toggle override — defaults to whatever the Excel parse
    // resolved (vendor mode if it found a matching Vendor Name column),
    // but stays independent per row once a person switches it manually.
    const [locationModeOverride, setLocationModeOverride] = useState<Record<number, 'type' | 'vendor'>>({})

    if (!(mounted && isOpen)) return null

    return createPortal(
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
            <div className="modal-content glass" style={{
                width: '95%',
                maxWidth: '1300px',
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column'
            }}>
                <div className="modal-header">
                    <h2 className="modal-title">{t('bulk_review_title')}</h2>
                    <button aria-label={t('close')} className="modal-close" onClick={onClose}>×</button>
                </div>

                <div className="modal-body" style={{ overflowY: 'auto', flex: 1, padding: '1.5rem' }}>
                    <div style={{ overflowX: 'auto', borderRadius: '1rem', border: '1px solid var(--glass-border)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--veil-40)' }}>
                            <thead>
                                <tr style={{ background: 'var(--veil-60)', borderBottom: '2px solid var(--glass-border)' }}>
                                    <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>#</th>
                                    <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('title')}</th>
                                    <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('description_label' as any)}</th>
                                    <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('assignees_label')}</th>
                                    <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('deadline_label')}</th>
                                    <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('location_name_label')}</th>
                                    <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('actions_label')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bulkTasks.map((bt, idx) => (
                                    <tr key={idx} style={{
                                        borderBottom: '1px solid var(--glass-border)',
                                        background: bt.isInvalid ? 'color-mix(in srgb, var(--danger-solid) 5%, transparent)' : 'transparent',
                                        transition: 'background 0.3s'
                                    }}>
                                        <td style={{ padding: '1rem' }}>{idx + 1}</td>
                                        <td style={{ padding: '1rem', position: 'relative' }}>
                                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                                                <div style={{
                                                    opacity: bt.isInvalid ? 0.5 : 1,
                                                    textDecoration: bt.isInvalid && !bt.title ? 'line-through' : 'none',
                                                    flex: 1
                                                }}>
                                                    {bt.title || t('missing_title')}
                                                </div>
                                                <button aria-label={t('edit')}
                                                    onClick={(e) => {
                                                        const rect = e.currentTarget.getBoundingClientRect()
                                                        setEditAnchorRect(rect)
                                                        setActiveCellEdit({ index: idx, field: 'title' })
                                                    }}
                                                    style={{
                                                        background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem',
                                                        borderRadius: '0.3rem', transition: 'all 0.2s', fontSize: '1rem',
                                                        opacity: bt.validationErrors?.title ? 1 : 0.4
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--hairline)'}
                                                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                                    title={t('edit')}
                                                >
                                                    <span aria-hidden="true">✍️</span>
                                                </button>
                                            </div>
                                            {bt.validationErrors?.title && (
                                                <div style={{ color: 'var(--danger-fg-strong)', fontSize: '0.7rem', marginTop: '0.25rem' }}>
                                                    {bt.validationErrors.title.map((err: string, i: number) => (
                                                        <div key={i}>• {err}</div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Title Pop-up */}
                                            {activeCellEdit?.index === idx && activeCellEdit?.field === 'title' && editAnchorRect && createPortal(
                                                <>
                                                    <div onClick={() => setActiveCellEdit(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10500 }} />
                                                    <div style={{
                                                        position: 'fixed',
                                                        top: editAnchorRect.top + editAnchorRect.height / 2,
                                                        left: locale === 'ar' ? editAnchorRect.left - 200 : editAnchorRect.right + 20,
                                                        transform: 'translateY(-50%)',
                                                        zIndex: 10501, minWidth: '280px', background: 'var(--surface)', padding: '1rem',
                                                        borderRadius: '0.75rem', boxShadow: '0 10px 25px var(--shadow-mid)', border: '1px solid var(--border)',
                                                        direction: locale === 'ar' ? 'rtl' : 'ltr'
                                                    }}>
                                                        <input
                                                            autoFocus
                                                            className="input"
                                                            style={{ width: '100%' }}
                                                            value={bt.title || ''}
                                                            onChange={e => {
                                                                const newTasks = [...bulkTasks]
                                                                newTasks[idx].title = e.target.value
                                                                const validated = revalidateRow(newTasks[idx])
                                                                newTasks[idx] = validated
                                                                setBulkTasks(newTasks)
                                                            }}
                                                        />
                                                        <button
                                                            className="btn btn-primary"
                                                            style={{ width: '100%', marginTop: '1rem' }}
                                                            onClick={() => setActiveCellEdit(null)}
                                                        >
                                                            {t('done')}
                                                        </button>
                                                    </div>
                                                </>,
                                                document.body
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem', position: 'relative' }}>
                                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                                                <div style={{ opacity: bt.isInvalid ? 0.5 : 1, fontSize: '0.85rem', flex: 1 }}>
                                                    {bt.description?.substring(0, 50)}...
                                                </div>
                                                <button aria-label={t('edit')}
                                                    onClick={(e) => {
                                                        const rect = e.currentTarget.getBoundingClientRect()
                                                        setEditAnchorRect(rect)
                                                        setActiveCellEdit({ index: idx, field: 'description' })
                                                    }}
                                                    style={{
                                                        background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem',
                                                        borderRadius: '0.3rem', transition: 'all 0.2s', fontSize: '1rem',
                                                        opacity: bt.validationErrors?.description ? 1 : 0.4
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--hairline)'}
                                                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                                    title={t('edit')}
                                                >
                                                    <span aria-hidden="true">✍️</span>
                                                </button>
                                            </div>
                                            {bt.validationErrors?.description && (
                                                <div style={{ color: 'var(--danger-fg-strong)', fontSize: '0.7rem', marginTop: '0.25rem' }}>
                                                    {bt.validationErrors.description.map((err: string, i: number) => (
                                                        <div key={i}>• {err}</div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Description Pop-up */}
                                            {activeCellEdit?.index === idx && activeCellEdit?.field === 'description' && editAnchorRect && createPortal(
                                                <>
                                                    <div onClick={() => setActiveCellEdit(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10500 }} />
                                                    <div style={{
                                                        position: 'fixed',
                                                        top: editAnchorRect.top + editAnchorRect.height / 2,
                                                        left: locale === 'ar' ? editAnchorRect.left - 340 : editAnchorRect.right + 20,
                                                        transform: 'translateY(-50%)',
                                                        zIndex: 10501, minWidth: '320px', background: 'var(--surface)', padding: '1rem',
                                                        borderRadius: '0.75rem', boxShadow: '0 10px 25px var(--shadow-mid)', border: '1px solid var(--border)',
                                                        direction: locale === 'ar' ? 'rtl' : 'ltr'
                                                    }}>
                                                        <textarea
                                                            autoFocus
                                                            className="input"
                                                            style={{ width: '100%', minHeight: '150px' }}
                                                            value={bt.description || ''}
                                                            onChange={e => {
                                                                const newTasks = [...bulkTasks]
                                                                newTasks[idx].description = e.target.value
                                                                const validated = revalidateRow(newTasks[idx])
                                                                newTasks[idx] = validated
                                                                setBulkTasks(newTasks)
                                                            }}
                                                        />
                                                        <button
                                                            className="btn btn-primary"
                                                            style={{ width: '100%', marginTop: '1rem' }}
                                                            onClick={() => setActiveCellEdit(null)}
                                                        >
                                                            {t('done')}
                                                        </button>
                                                    </div>
                                                </>,
                                                document.body
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem', position: 'relative' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: '250px' }}>
                                                <div style={{
                                                    flex: 1,
                                                    opacity: bt.isInvalid ? 0.6 : 1,
                                                    color: bt.unresolvedUsernames.length > 0 ? 'var(--danger-fg-strong)' : 'inherit',
                                                    fontSize: '0.85rem',
                                                    background: 'var(--veil-20)',
                                                    padding: '0.5rem',
                                                    borderRadius: '0.5rem',
                                                    border: '1px solid var(--glass-border)',
                                                    minHeight: '40px',
                                                    display: 'flex',
                                                    alignItems: 'center'
                                                }}>
                                                    {bt.resolvedNames && bt.resolvedNames.length > 0 ? bt.resolvedNames.join(', ') : bt.usernamesRaw || t('no_assignees')}
                                                </div>
                                                {bt.validationErrors?.assignees && (
                                                    <div style={{ color: 'var(--danger-fg-strong)', fontSize: '0.7rem', marginTop: '0.25rem' }}>
                                                        {bt.validationErrors.assignees.map((err: string, i: number) => (
                                                            <div key={i}>• {err}</div>
                                                        ))}
                                                    </div>
                                                )}

                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                    {/* Plus Button */}
                                                    <button aria-label={t('add_assignee')}
                                                        onClick={(e) => {
                                                            const rect = e.currentTarget.getBoundingClientRect()
                                                            setEditAnchorRect(rect)
                                                            setActiveAssigneeEdit(activeAssigneeEdit?.index === idx && activeAssigneeEdit?.type === 'add' ? null : { index: idx, type: 'add' })
                                                            setAssigneeSearch('')
                                                        }}
                                                        style={{
                                                            width: '28px',
                                                            height: '28px',
                                                            borderRadius: '50%',
                                                            border: '1px solid var(--glass-border)',
                                                            background: 'var(--veil-40)',
                                                            backdropFilter: 'blur(8px)',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            cursor: 'pointer',
                                                            fontSize: '1.2rem',
                                                            fontWeight: 'bold',
                                                            color: 'var(--info-fg)',
                                                            transition: 'all 0.2s'
                                                        }}
                                                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--veil-60)'; e.currentTarget.style.transform = 'scale(1.1)'; }}
                                                        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--veil-40)'; e.currentTarget.style.transform = 'scale(1)'; }}
                                                    >
                                                        +
                                                    </button>

                                                    {/* Minus Button */}
                                                    <button aria-label={t('remove_assignee')}
                                                        onClick={(e) => {
                                                            const rect = e.currentTarget.getBoundingClientRect()
                                                            setEditAnchorRect(rect)
                                                            setActiveAssigneeEdit(activeAssigneeEdit?.index === idx && activeAssigneeEdit?.type === 'remove' ? null : { index: idx, type: 'remove' })
                                                        }}
                                                        style={{
                                                            width: '28px',
                                                            height: '28px',
                                                            borderRadius: '50%',
                                                            border: '1px solid var(--glass-border)',
                                                            background: 'var(--veil-40)',
                                                            backdropFilter: 'blur(8px)',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            cursor: 'pointer',
                                                            fontSize: '1.2rem',
                                                            fontWeight: 'bold',
                                                            color: 'var(--danger-fg-strong)',
                                                            transition: 'all 0.2s'
                                                        }}
                                                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--veil-60)'; e.currentTarget.style.transform = 'scale(1.1)'; }}
                                                        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--veil-40)'; e.currentTarget.style.transform = 'scale(1)'; }}
                                                    >
                                                        -
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Dropdowns/Popups */}
                                            {activeAssigneeEdit?.index === idx && editAnchorRect && createPortal(
                                                <>
                                                    <div
                                                        onClick={() => setActiveAssigneeEdit(null)}
                                                        style={{
                                                            position: 'fixed',
                                                            top: 0,
                                                            left: 0,
                                                            right: 0,
                                                            bottom: 0,
                                                            zIndex: 10500,
                                                            background: 'transparent',
                                                            cursor: 'default'
                                                        }}
                                                    />
                                                    <div style={{
                                                        position: 'fixed',
                                                        top: editAnchorRect.top + editAnchorRect.height / 2,
                                                        left: locale === 'ar' ? editAnchorRect.left - 260 : editAnchorRect.right + 20,
                                                        transform: 'translateY(-50%)',
                                                        zIndex: 10501,
                                                        minWidth: '240px',
                                                        background: 'var(--panel-95)',
                                                        backdropFilter: 'blur(12px)',
                                                        border: '1px solid var(--glass-border)',
                                                        borderRadius: '0.75rem',
                                                        boxShadow: '0 10px 15px -3px var(--shadow-weak)',
                                                        padding: '0.5rem',
                                                        animation: 'fadeIn 0.2s ease-out',
                                                        direction: locale === 'ar' ? 'rtl' : 'ltr'
                                                    }}>
                                                        {activeAssigneeEdit.type === 'add' ? (
                                                            // Add Dropdown
                                                            <div>
                                                                <div style={{ padding: '0.25rem 0.25rem 0.5rem 0.25rem', borderBottom: '1px solid var(--border)', marginBottom: '0.5rem' }}>
                                                                    <input
                                                                        autoFocus
                                                                        type="text"
                                                                        placeholder={t('search_placeholder')}
                                                                        value={assigneeSearch}
                                                                        onChange={(e) => setAssigneeSearch(e.target.value)}
                                                                        style={{
                                                                            width: '100%',
                                                                            padding: '0.4rem 0.6rem',
                                                                            fontSize: '0.8rem',
                                                                            borderRadius: '0.5rem',
                                                                            border: '1px solid var(--border)',
                                                                            background: 'var(--surface-subtle)',
                                                                            textAlign: locale === 'ar' ? 'right' : 'left'
                                                                        }}
                                                                    />
                                                                </div>
                                                                <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                                                                    {users
                                                                        .filter(u => !bt.resolvedIds.includes(u.id))
                                                                        .filter(u =>
                                                                            `${u.firstName} ${u.lastName}`.toLowerCase().includes(assigneeSearch.toLowerCase())
                                                                        )
                                                                        .map(u => (
                                                                            <div
                                                                                key={u.id}
                                                                                onClick={() => {
                                                                                    const newTasks = [...bulkTasks]
                                                                                    newTasks[idx].resolvedIds = [...bt.resolvedIds, u.id]
                                                                                    newTasks[idx].resolvedNames = [...bt.resolvedNames, `${u.firstName} ${u.lastName}`]
                                                                                    newTasks[idx].unresolvedUsernames = []

                                                                                    // Re-validate row after edit
                                                                                    const updatedErrors = { ...(bt.validationErrors || {}) }
                                                                                    delete updatedErrors.assignees
                                                                                    newTasks[idx].validationErrors = updatedErrors
                                                                                    newTasks[idx].isInvalid = Object.keys(updatedErrors).length > 0

                                                                                    setBulkTasks(newTasks)
                                                                                    // Don't close pop-up as per request
                                                                                }}
                                                                                style={{
                                                                                    padding: '0.5rem',
                                                                                    fontSize: '0.85rem',
                                                                                    cursor: 'pointer',
                                                                                    borderRadius: '0.375rem',
                                                                                    transition: 'background 0.2s',
                                                                                    textAlign: locale === 'ar' ? 'right' : 'left'
                                                                                }}
                                                                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-sunk)'}
                                                                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                                                            >
                                                                                <div style={{ fontWeight: '600' }}>{u.firstName} {u.lastName}</div>
                                                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>{t(`role_${u.role?.toLowerCase()}` as any)}</div>
                                                                            </div>
                                                                        ))}
                                                                    {users.filter(u => !bt.resolvedIds.includes(u.id) && `${u.firstName} ${u.lastName}`.toLowerCase().includes(assigneeSearch.toLowerCase())).length === 0 && (
                                                                        <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-faint)' }}>{t('no_matches_found')}</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            // Remove Popup
                                                            <div>
                                                                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-soft)', padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '0.25rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                                    {t('remove_assignee')}
                                                                </div>
                                                                <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                                                                    {bt.resolvedIds.map((id: string, ridx: number) => (
                                                                        <div
                                                                            key={id}
                                                                            style={{
                                                                                display: 'flex',
                                                                                justifyContent: 'space-between',
                                                                                alignItems: 'center',
                                                                                padding: '0.5rem',
                                                                                fontSize: '0.85rem',
                                                                                borderRadius: '0.375rem',
                                                                                flexDirection: locale === 'ar' ? 'row-reverse' : 'row'
                                                                            }}
                                                                        >
                                                                            <span style={{ fontWeight: '500' }}>{bt.resolvedNames[ridx]}</span>
                                                                            <button aria-label={t('remove_assignee')}
                                                                                onClick={() => {
                                                                                    const newTasks = [...bulkTasks]
                                                                                    const nid = bt.resolvedIds.filter((_: any, i: number) => i !== ridx)
                                                                                    const nname = bt.resolvedNames.filter((_: any, i: number) => i !== ridx)
                                                                                    newTasks[idx].resolvedIds = nid
                                                                                    newTasks[idx].resolvedNames = nname

                                                                                    // Re-validate row after remove
                                                                                    const updatedErrors = { ...(bt.validationErrors || {}) }
                                                                                    if (nid.length === 0) {
                                                                                        updatedErrors.assignees = [t('no_assignees' as any) || 'Missing assignees']
                                                                                    } else {
                                                                                        delete updatedErrors.assignees
                                                                                    }
                                                                                    newTasks[idx].validationErrors = updatedErrors
                                                                                    newTasks[idx].isInvalid = Object.keys(updatedErrors).length > 0

                                                                                    setBulkTasks(newTasks)
                                                                                    // Pop-up stays open as requested
                                                                                }}
                                                                                style={{
                                                                                    border: 'none',
                                                                                    background: 'var(--danger-bg)',
                                                                                    color: 'var(--danger-fg-strong)',
                                                                                    borderRadius: '50%',
                                                                                    width: '20px',
                                                                                    height: '20px',
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    justifyContent: 'center',
                                                                                    cursor: 'pointer',
                                                                                    fontSize: '0.9rem'
                                                                                }}
                                                                            >
                                                                                ×
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                    {bt.resolvedIds.length === 0 && (
                                                                        <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-faint)' }}>{t('no_assignees')}</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </>,
                                                document.body
                                            )}

                                        </td>
                                        <td style={{ padding: '1rem', position: 'relative' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                                                <div style={{ opacity: bt.isInvalid ? 0.5 : 1, whiteSpace: 'nowrap', fontSize: '0.85rem', flex: 1 }}>
                                                    {bt.deadline ? new Date(bt.deadline).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US', {
                                                        year: 'numeric', month: 'numeric', day: 'numeric',
                                                        hour: 'numeric', minute: 'numeric', second: 'numeric',
                                                        hour12: true
                                                    }) : t('invalid_date')}
                                                </div>
                                                <DateTimePicker
                                                    value={bt.deadline || ''}
                                                    onChange={v => {
                                                        const newTasks = [...bulkTasks]
                                                        newTasks[idx].deadline = v
                                                        const validated = revalidateRow(newTasks[idx])
                                                        newTasks[idx] = validated
                                                        setBulkTasks(newTasks)
                                                    }}
                                                    min={earliestDeadline(now).toISOString()}
                                                    customTrigger={
                                                        <button aria-label={t('edit_deadline')}
                                                            style={{
                                                                background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem',
                                                                borderRadius: '0.3rem', transition: 'all 0.2s', fontSize: '1.1rem',
                                                                opacity: bt.validationErrors?.deadline ? 1 : 0.4
                                                            }}
                                                            onMouseEnter={e => e.currentTarget.style.background = 'var(--hairline)'}
                                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                                            title={t('edit_deadline')}
                                                        >
                                                            <span aria-hidden="true">📅</span>
                                                        </button>
                                                    }
                                                />
                                            </div>
                                            {bt.validationErrors?.deadline && (
                                                <div style={{ color: 'var(--danger-fg-strong)', fontSize: '0.7rem', marginTop: '0.25rem' }}>
                                                    {bt.validationErrors.deadline.map((err: string, i: number) => (
                                                        <div key={i}>• {err}</div>
                                                    ))}
                                                </div>
                                            )}

                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            <div style={{ minWidth: '170px' }}>
                                                {vendors.length > 0 && (() => {
                                                    const mode = locationModeOverride[idx] || (bt.vendorId ? 'vendor' : 'type')
                                                    return (
                                                        <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.4rem' }}>
                                                            <button
                                                                type="button"
                                                                onClick={() => setLocationModeOverride({ ...locationModeOverride, [idx]: 'type' })}
                                                                className={mode === 'vendor' ? 'btn' : 'btn btn-primary'}
                                                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}
                                                            >
                                                                {t('type_location' as any) || 'Type'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => setLocationModeOverride({ ...locationModeOverride, [idx]: 'vendor' })}
                                                                className={mode === 'vendor' ? 'btn btn-primary' : 'btn'}
                                                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}
                                                            >
                                                                {vendorsName}
                                                            </button>
                                                        </div>
                                                    )
                                                })()}

                                                {(locationModeOverride[idx] || (bt.vendorId ? 'vendor' : 'type')) === 'vendor' ? (
                                                    <select
                                                        aria-label={t('vendor_label' as any)}
                                                        value={bt.vendorId || ''}
                                                        onChange={(e) => {
                                                            const vendor = vendors.find((v: any) => v.id === e.target.value)
                                                            const newTasks = [...bulkTasks]
                                                            newTasks[idx].vendorId = vendor?.id || null
                                                            newTasks[idx].location = vendor?.locationName || ''
                                                            newTasks[idx].locationLink = vendor?.locationLink || ''
                                                            const updatedErrors = { ...(bt.validationErrors || {}) }
                                                            delete updatedErrors.vendor
                                                            newTasks[idx].validationErrors = updatedErrors
                                                            newTasks[idx].isInvalid = Object.keys(updatedErrors).length > 0
                                                            setBulkTasks(newTasks)
                                                        }}
                                                        className="input"
                                                        style={{ width: '100%', fontSize: '0.8rem' }}
                                                    >
                                                        <option value="">{t('select_vendor_placeholder' as any) || 'Select...'}</option>
                                                        {vendors.map((v: any) => (
                                                            <option key={v.id} value={v.id}>{v.name}</option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <LocationSearchInput
                                                        value={{ name: bt.location, link: bt.locationLink || '' }}
                                                        onChange={(val) => {
                                                            const newTasks = [...bulkTasks]
                                                            newTasks[idx].location = val.name
                                                            newTasks[idx].locationLink = val.link
                                                            newTasks[idx].vendorId = null
                                                            setBulkTasks(newTasks)
                                                        }}
                                                        placeholder={t('location_name_placeholder')}
                                                        locale={locale}
                                                    />
                                                )}
                                                {bt.validationErrors?.vendor && (
                                                    <div style={{ color: 'var(--danger-fg-strong)', fontSize: '0.7rem', marginTop: '0.25rem' }}>
                                                        {bt.validationErrors.vendor.map((err: string, i: number) => (
                                                            <div key={i}>• {err}</div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            <button
                                                className="btn"
                                                style={{
                                                    padding: '0.4rem 0.8rem',
                                                    background: 'color-mix(in srgb, var(--danger-solid) 10%, transparent)',
                                                    color: 'var(--danger-solid-hover)',
                                                    borderRadius: '0.75rem'
                                                }}
                                                onClick={() => {
                                                    const newTasks = bulkTasks.filter((_, i) => i !== idx)
                                                    setBulkTasks(newTasks)
                                                    if (newTasks.length === 0) onClose()
                                                }}
                                            >
                                                {t('delete')}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="modal-footer" style={{ borderTop: '1px solid var(--glass-border)', background: 'var(--veil-30)' }}>
                    <div style={{ flex: 1 }}>
                        {bulkTasks.some(bt => bt.isInvalid) && (
                            <div style={{ color: 'var(--danger-fg)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span aria-hidden="true" style={{ fontSize: '1.1rem' }}>⚠️</span>
                                {t('skipped_status')}: {bulkTasks.filter(bt => bt.isInvalid).length} {t('rows_with_errors' as any)}
                            </div>
                        )}
                    </div>
                    <button className="btn" onClick={onClose} style={{ background: 'var(--hairline)' }}>
                        {t('cancel')}
                    </button>
                    <button
                        className="btn btn-primary"
                        disabled={isSubmitting || bulkTasks.filter(bt => !bt.isInvalid).length === 0}
                        onClick={async () => {
                            setIsSubmitting(true)
                            const validToSubmit = bulkTasks.filter(bt => !bt.isInvalid).map(bt => ({
                                title: bt.title,
                                description: bt.description,
                                assigneeIds: bt.resolvedIds,
                                deadline: bt.deadline,
                                difficulty: bt.difficulty,
                                location: bt.location ? JSON.stringify({ name: bt.location, link: bt.locationLink || '' }) : '',
                                vendorId: bt.vendorId || undefined
                            }))

                            try {
                                const res = await fetch('/api/tasks/bulk', {
                                    method: 'POST',
                                    body: JSON.stringify({ tasks: validToSubmit }),
                                    headers: { 'Content-Type': 'application/json' }
                                })

                                if (!res.ok) {
                                    const errorData = await res.json().catch(() => ({}))
                                    const msg = errorData.error || errorData.details || errorData.message || (errorData.data?.error) || t('bulk_create_failed')
                                    throw new Error(msg)
                                }

                                showToast(t('bulk_create_success'), 'success')
                                onClose()
                                router.push('/dashboard/tasks')
                            } catch (err: any) {
                                showToast(err.message, 'error')
                            } finally {
                                setIsSubmitting(false)
                            }
                        }}
                        style={{ minWidth: '160px' }}
                    >
                        {isSubmitting ? t('processing') : (
                            <>
                                <span aria-hidden="true">✨</span>
                                {t('create_tasks')} ({bulkTasks.filter(bt => !bt.isInvalid).length})
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}
