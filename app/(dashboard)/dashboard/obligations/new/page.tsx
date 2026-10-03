'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DateTimePicker from '@/components/DateTimePicker'
import { useLanguage } from '@/context/LanguageContext'
import { useCompany } from '@/context/CompanyContext'
import { useNow } from '@/lib/useNow'
import { earliestDeadline } from '@/lib/deadline'
import { permissionsOf, useCan } from '@/lib/useCan'
import AccessDenied from '@/components/AccessDenied'

export default function NewObligationPage() {
    const { t, locale } = useLanguage()
    // The deadline floor offered to the picker, kept current while the form
    // stays open. See lib/useNow.ts.
    const now = useNow()
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [assigneeIds, setAssigneeIds] = useState<string[]>([])
    const [deadline, setDeadline] = useState('')
    const [difficulty, setDifficulty] = useState('')
    const [recurrence, setRecurrence] = useState('ONE_TIME')
    const [searchTerm, setSearchTerm] = useState('')
    const [users, setUsers] = useState<any[]>([])
    const router = useRouter()

    const { data: session } = useSession()
    const { selectedCompanyId } = useCompany()
    // Creating obligations is a manager's (the list offers the button only to
    // them); anyone else reaching this address by hand is told so, rather
    // than asking for a colleague list they may not read.
    const mayCreate = useCan().can('obligations.manage')

    useEffect(() => {
        if (!mayCreate) return
        const queryParams = new URLSearchParams()
        queryParams.set('limit', '1000')
        if (selectedCompanyId) queryParams.set('companyId', selectedCompanyId)

        fetch(`/api/users?${queryParams.toString()}`)
            .then(res => res.json())
            .then(result => {
                const usersList = result?.data?.data || []
                // Sort by role: EMPLOYEE -> TEAM_LEADER -> ADMIN -> SUPER_ADMIN
                const sortedData = usersList.sort((a: any, b: any) => {
                    const rolePriority: { [key: string]: number } = {
                        'EMPLOYEE': 1,
                        'TEAM_LEADER': 2,
                        'ADMIN': 3,
                        'SUPER_ADMIN': 4
                    }
                    const priorityA = rolePriority[a.role] || 99
                    const priorityB = rolePriority[b.role] || 99

                    if (priorityA !== priorityB) {
                        return priorityA - priorityB
                    }
                    // Secondary sort by name if same role
                    return a.firstName.localeCompare(b.firstName)
                })
                // A team-scoped manager is not offered the company's Admins.
                const permissions = permissionsOf(session?.user as any)
                const teamOnly = permissions.can('obligations.manage') && !permissions.companyWide('obligations.manage')
                const filteredData = teamOnly
                    ? sortedData.filter((u: any) => !['ADMIN', 'SUPER_ADMIN'].includes(u.role))
                    : sortedData
                setUsers(filteredData)
            })
    }, [session, selectedCompanyId, mayCreate])

    const [error, setError] = useState('')
    const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({})
    const [isSubmitting, setIsSubmitting] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setFieldErrors({})
        setIsSubmitting(true)
        setError('')

        // Client-side Validation
        const errors: { [key: string]: string } = {}
        if (!title || title.length < 3 || title.length > 100) {
            errors.title = t('task_title_validation' as any)
        }
        if (!description || description.length < 10 || description.length > 500) {
            errors.description = t('obligation_description_validation' as any)
        }

        if (Object.keys(errors).length > 0) {
            setFieldErrors(errors)
            setIsSubmitting(false)

            // Auto-scroll to first error
            const firstErrorField = Object.keys(errors)[0]
            const element = document.getElementById(`field-${firstErrorField}`)
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
            return
        }

        try {
            // Attachments removed from creation as per user request

            const res = await fetch('/api/obligations', {
                method: 'POST',
                body: JSON.stringify({
                    title,
                    description,
                    assigneeIds,
                    deadline,
                    difficulty: parseInt(difficulty) || 0,
                    recurrence,
                    attachments: []
                }),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                // data.error is always a plain string; data.details (when
                // present) is a raw Zod .format() object and must never be
                // used as the message itself — stringifying it renders as
                // literal "[object Object]".
                throw new Error(data.error || `${t('error_generic')} (${res.status})`)
            }

            router.push('/dashboard/obligations')
            router.refresh()
        } catch (err: any) {
            console.error(err)
            setError(err.message || t('error_generic'))
            setIsSubmitting(false)
        }
    }

    const containerStyle: React.CSSProperties = {
        direction: locale === 'ar' ? 'rtl' : 'ltr',
        textAlign: locale === 'ar' ? 'right' : 'left'
    }

    const filteredUsers = users.filter(u => {
        const fullName = `${u.firstName} ${u.lastName}`.toLowerCase()
        return fullName.includes(searchTerm.toLowerCase())
    })

    if (!mayCreate) return <AccessDenied />

    return (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto', ...containerStyle }}>
            <h1 style={{ marginBottom: '1.5rem' }}>{t('add_obligation')}</h1>
            {error && (
                <div style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)', padding: '1rem', borderRadius: '0.5rem', marginBottom: '1rem', border: '1px solid var(--danger-border)' }}>
                    {error}
                </div>
            )}
            <form onSubmit={handleSubmit}>
                <div id="field-title" style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('title_label' as any)}</label>
                    <input aria-label={t('title_label' as any)}
                        className="input"
                        value={title}
                        onChange={e => {
                            setTitle(e.target.value)
                            if (fieldErrors.title) setFieldErrors({ ...fieldErrors, title: '' })
                        }}
                        style={fieldErrors.title ? { borderColor: 'var(--danger-solid)' } : {}}
                        required
                        maxLength={100}
                    />
                    {fieldErrors.title && (
                        <div style={{ color: 'var(--danger-solid)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            {fieldErrors.title}
                        </div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: title.length >= 100 ? 'var(--danger-solid)' : 'var(--text-faint)', textAlign: locale === 'ar' ? 'left' : 'right', marginTop: '0.25rem' }}>
                        {title.length}/100
                    </div>
                </div>
                <div id="field-description" style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('description_label' as any)}</label>
                    <textarea aria-label={t('description_label' as any)}
                        className="input"
                        value={description}
                        onChange={e => {
                            setDescription(e.target.value)
                            if (fieldErrors.description) setFieldErrors({ ...fieldErrors, description: '' })
                        }}
                        style={fieldErrors.description ? { borderColor: 'var(--danger-solid)' } : {}}
                        rows={4}
                        required
                        maxLength={500}
                    />
                    {fieldErrors.description && (
                        <div style={{ color: 'var(--danger-solid)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            {fieldErrors.description}
                        </div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: description.length >= 500 ? 'var(--danger-solid)' : 'var(--text-faint)', textAlign: locale === 'ar' ? 'left' : 'right', marginTop: '0.25rem' }}>
                        {description.length}/500
                    </div>
                </div>
                <div id="field-assigneeIds" style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('assignee_label')}</label>
                    <input aria-label={t('assignee_label')}
                        type="text"
                        className="input"
                        placeholder={t('search_placeholder')}
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}
                    />
                    <div style={{
                        maxHeight: '200px',
                        overflowY: 'auto',
                        border: '1px solid var(--border)',
                        borderRadius: '0.5rem',
                        padding: '0.75rem',
                        background: 'var(--surface)'
                    }}>
                        {filteredUsers.length > 0 ? filteredUsers.map(u => (
                            <label key={u.id} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                marginBottom: '0.5rem',
                                cursor: 'pointer',
                                padding: '0.25rem',
                                borderRadius: '0.25rem',
                                background: assigneeIds.includes(u.id) ? 'var(--info-bg-sky)' : 'transparent'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={assigneeIds.includes(u.id)}
                                    onChange={e => {
                                        if (e.target.checked) {
                                            setAssigneeIds([...assigneeIds, u.id])
                                        } else {
                                            setAssigneeIds(assigneeIds.filter(id => id !== u.id))
                                        }
                                        if (fieldErrors.assigneeIds) setFieldErrors({ ...fieldErrors, assigneeIds: '' })
                                    }}
                                />
                                <span style={{ fontSize: '0.9rem' }}>
                                    {u.firstName} {u.lastName} <small style={{ color: 'var(--text-soft)' }}>({t(`role_${u.role?.toLowerCase().replace('team_leader', 'team_leader').replace('employee', 'employee').replace('admin', 'admin')}` as any)})</small>
                                </span>
                            </label>
                        )) : (
                            <div style={{ color: 'var(--text-soft)', fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>
                                {t('no_data_available')}
                            </div>
                        )}
                    </div>
                    {fieldErrors.assigneeIds && (
                        <div style={{ color: 'var(--danger-solid)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            {fieldErrors.assigneeIds}
                        </div>
                    )}
                </div>
                <div id="field-deadline" style={{ marginBottom: '1.25rem' }}>
                    <DateTimePicker
                        label={t('deadline_label')}
                        value={deadline}
                        onChange={setDeadline}
                        min={earliestDeadline(now).toISOString()}
                    />
                </div>
                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('recurrence_label')}</label>
                    <select aria-label={t('recurrence_label')}
                        className="input"
                        value={recurrence}
                        onChange={e => setRecurrence(e.target.value)}
                        required
                    >
                        <option value="ONE_TIME">{t('recurrence_one_time')}</option>
                        <option value="DAILY">{t('recurrence_daily')}</option>
                        <option value="WEEKLY">{t('recurrence_weekly')}</option>
                        <option value="MONTHLY">{t('recurrence_monthly')}</option>
                    </select>
                </div>
                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('difficulty')}</label>
                    <input aria-label={t('difficulty')}
                        type="number"
                        className="input"
                        value={difficulty}
                        onChange={e => {
                            const val = e.target.value
                            if (val === '') {
                                setDifficulty('')
                            } else {
                                const num = parseInt(val)
                                setDifficulty(Math.min(Math.max(num, 0), 10).toString())
                            }
                        }}
                        min="0"
                        max="10"
                        placeholder="0-10"
                        required
                    />
                </div>



                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                        {isSubmitting ? t('creating') : t('create_obligation_button' as any)}
                    </button>
                    <button
                        type="button"
                        className="btn"
                        style={{ background: 'var(--border)', color: 'var(--text-strong)' }}
                        onClick={() => router.push('/dashboard/obligations')}
                    >
                        {t('cancel')}
                    </button>
                </div>
            </form >
        </div >
    )
}
