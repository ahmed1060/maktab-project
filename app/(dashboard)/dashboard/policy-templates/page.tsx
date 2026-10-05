'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import ConfirmModal from '@/components/ConfirmModal'
import LoadingSpinner from '@/components/LoadingSpinner'
import { PolicyEditor } from '@/components/AttendancePolicyPanel'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import { fetcher } from '@/lib/swr-fetcher'
import { apiErrorText } from '@/lib/api-error-text'
import { STANDARD_OFFICE, type PolicyBody } from '@/lib/attendance/policy'

/**
 * Attendance policy templates (ATTENDANCE_PLAN.md §6.8): the Super Admin's
 * starting points — "Standard Egyptian office", "Six-day factory" — that a
 * company copies into its own policy. Applying one copies it, so editing or
 * removing a template here changes no company's policy.
 */

type Template = { id: string; name: string; nameAr: string | null; description: string | null; body: PolicyBody }
type Editing = { id: string | null; name: string; nameAr: string; description: string; body: PolicyBody }

export default function PolicyTemplatesPage() {
    const { t, locale } = useLanguage()
    const isRtl = locale === 'ar'
    const intl = isRtl ? 'ar-EG' : 'en-GB'
    const { setTitle, setSubtitle } = useHeader()
    const { showToast } = useToast()
    const { data: session } = useSession()
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

    const { data, isLoading, mutate } = useSWR(isSuperAdmin ? '/api/policy-templates' : null, fetcher)
    const templates: Template[] = data?.data?.templates ?? []
    const [editing, setEditing] = useState<Editing | null>(null)
    const [removing, setRemoving] = useState<Template | null>(null)

    useEffect(() => {
        setTitle(t('ptpl_title'))
        setSubtitle(t('ptpl_hint'))
        return () => { setTitle(null); setSubtitle(null) }
    }, [t, setTitle, setSubtitle])

    if (session && !isSuperAdmin) return <AccessDenied />
    if (!session || isLoading) return <LoadingSpinner />

    const weekday = (d: number) => new Date(Date.UTC(2026, 2, 1 + d)).toLocaleDateString(intl, { weekday: 'short', timeZone: 'UTC' })
    const fraction = (f: number) => f === 1 ? t('attendance_day_1') : f === 0.5 ? t('attendance_day_half') : f === 0.25 ? t('attendance_day_quarter') : f === 0.75 ? t('attendance_day_three_quarters') : String(f)
    const summary = (b: PolicyBody) => [
        b.workWeek.map(weekday).join(' '),
        b.lateness.enabled ? t('attendance_grace_n').replace('{n}', String(b.lateness.graceMinutes)) : t('attendance_rule_off'),
        t('attendance_absence_n').replace('{n}', String(b.absence.multiplier)),
        b.permissionHours.enabled ? t('ptpl_permission_n').replace('{n}', String(b.permissionHours.monthlyAllowanceMinutes)) : null,
    ].filter(Boolean).join(' · ')

    const save = async (body: PolicyBody) => {
        if (!editing) return
        const res = await fetch(editing.id ? `/api/policy-templates/${editing.id}` : '/api/policy-templates', {
            method: editing.id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: editing.name, nameAr: editing.nameAr || null, description: editing.description || null, body }),
        })
        if (!res.ok) return showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
        showToast(t('ptpl_saved'), 'success')
        setEditing(null)
        mutate()
    }

    const remove = async () => {
        const target = removing
        if (!target) return
        try {
            const res = await fetch(`/api/policy-templates/${target.id}`, { method: 'DELETE' })
            if (!res.ok) return showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
            showToast(t('ptpl_deleted'), 'success')
            mutate()
        } finally { setRemoving(null) }
    }

    const startNew = (from?: Template) => setEditing({
        id: null,
        name: from ? `${from.name} (copy)` : '',
        nameAr: from?.nameAr ? `${from.nameAr} (نسخة)` : '',
        description: from?.description ?? '',
        body: structuredClone(from?.body ?? STANDARD_OFFICE),
    })

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" onClick={() => startNew()}>{t('ptpl_new')}</button>
            </div>
            {templates.length === 0 ? <p style={{ color: 'var(--text-soft)' }}>{t('ptpl_none')}</p> : templates.map(tpl => (
                <section key={tpl.id} className="glass" style={{ padding: '1.1rem 1.25rem', borderRadius: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
                        <h3 style={{ margin: 0, fontSize: '1rem' }}>{isRtl && tpl.nameAr ? tpl.nameAr : tpl.name}</h3>
                        {(isRtl ? tpl.name : tpl.nameAr) && <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)' }}>{isRtl ? tpl.name : tpl.nameAr}</div>}
                        {tpl.description && <p style={{ margin: '0.35rem 0 0', fontSize: '0.86rem' }}>{tpl.description}</p>}
                        <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-soft)' }}>{summary(tpl.body)}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <button className="btn btn-secondary" onClick={() => setEditing({ id: tpl.id, name: tpl.name, nameAr: tpl.nameAr ?? '', description: tpl.description ?? '', body: structuredClone(tpl.body) })}>{t('edit')}</button>
                        <button className="btn btn-secondary" onClick={() => startNew(tpl)}>{t('ptpl_copy')}</button>
                        <button className="btn btn-secondary" style={{ color: 'var(--danger-fg)' }} onClick={() => setRemoving(tpl)}>{t('delete')}</button>
                    </div>
                </section>
            ))}

            {editing && (
                <PolicyEditor
                    start={editing.body}
                    weekday={weekday}
                    fraction={fraction}
                    title={editing.id ? t('ptpl_edit') : t('ptpl_new')}
                    canSave={editing.name.trim().length > 0}
                    header={
                        <div style={{ display: 'grid', gap: '0.6rem' }}>
                            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-soft)' }}>{t('ptpl_copied_hint')}</p>
                            <label style={{ display: 'grid', gap: '0.25rem' }}>
                                <span className="label">{t('ptpl_name')}</span>
                                <input className="input" value={editing.name} maxLength={80} onChange={e => setEditing({ ...editing, name: e.target.value })} />
                            </label>
                            <label style={{ display: 'grid', gap: '0.25rem' }}>
                                <span className="label">{t('ptpl_name_ar')}</span>
                                <input className="input" dir="rtl" value={editing.nameAr} maxLength={80} onChange={e => setEditing({ ...editing, nameAr: e.target.value })} />
                            </label>
                            <label style={{ display: 'grid', gap: '0.25rem' }}>
                                <span className="label">{t('ptpl_description')}</span>
                                <textarea className="input" rows={2} value={editing.description} maxLength={500} onChange={e => setEditing({ ...editing, description: e.target.value })} />
                            </label>
                        </div>
                    }
                    onClose={() => setEditing(null)}
                    onSave={async (_from, body) => { await save(body) }}
                />
            )}
            <ConfirmModal
                isOpen={!!removing}
                title={t('delete')}
                message={t('ptpl_delete_confirm').replace('{name}', removing?.name ?? '')}
                confirmText={t('delete')}
                variant="danger"
                onConfirm={remove}
                onCancel={() => setRemoving(null)}
            />
        </div>
    )
}
