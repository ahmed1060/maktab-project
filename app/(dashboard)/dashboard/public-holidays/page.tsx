'use client'

import { useCallback, useEffect, useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import LoadingSpinner from '@/components/LoadingSpinner'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import { useToast } from '@/context/ToastContext'
import { apiErrorText } from '@/lib/api-error-text'

/**
 * The central calendar of public holidays (ATTENDANCE_PLAN.md §7.2), for the
 * Super Admin. Every company with attendance observes these unless it opts a
 * day out. Moving a day here — Egyptian holidays are sometimes moved by
 * decree — moves it for every company that observes it.
 */

type Holiday = { id: string; date: string; name: string; nameAr: string | null; companiesSkipping: number }
type Draft = { id: string | null; date: string; name: string; nameAr: string }

const EMPTY: Draft = { id: null, date: '', name: '', nameAr: '' }

export default function PublicHolidaysPage() {
    const { t, locale } = useLanguage()
    const isRtl = locale === 'ar'
    const { setTitle, setSubtitle } = useHeader()
    const { showToast } = useToast()
    const { data: session, status } = useSession()

    const [year, setYear] = useState(() => new Date().getFullYear())
    const [draft, setDraft] = useState<Draft>(EMPTY)
    const [removing, setRemoving] = useState<Holiday | null>(null)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        setTitle(t('public_holidays_title'))
        setSubtitle(t('public_holidays_hint'))
        return () => { setTitle(null); setSubtitle(null) }
    }, [t, setTitle, setSubtitle])

    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

    const { data: body, mutate } = useSWR(isSuperAdmin ? `/api/public-holidays?year=${year}` : null, fetcher)
    const holidays: Holiday[] | null = body ? body.data?.holidays ?? [] : null
    const load = useCallback(async () => { await mutate() }, [mutate])

    if (status === 'loading') return <LoadingSpinner />
    if (!isSuperAdmin) return <AccessDenied />

    const save = async () => {
        setBusy(true)
        try {
            const res = await fetch(draft.id ? `/api/public-holidays/${draft.id}` : '/api/public-holidays', {
                method: draft.id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: draft.date, name: draft.name.trim(), nameAr: draft.nameAr.trim() || null }),
            })
            if (!res.ok) {
                showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
                return
            }
            showToast(t('settings_saved_success'), 'success')
            if (draft.date.slice(0, 4) !== String(year)) setYear(Number(draft.date.slice(0, 4)))
            setDraft(EMPTY)
            await load()
        } finally {
            setBusy(false)
        }
    }

    const dateText = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(isRtl ? 'ar-EG' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' })

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '48rem', textAlign: isRtl ? 'right' : 'left' }}>
            <section className="glass" style={{ padding: '1.5rem', borderRadius: '1rem' }} aria-labelledby="public-holiday-form">
                <h3 id="public-holiday-form" style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>
                    {draft.id ? t('public_holidays_edit') : t('public_holidays_add')}
                </h3>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                        <label htmlFor="ph-date" className="label">{t('date')}</label>
                        <input id="ph-date" className="input" type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} />
                    </div>
                    <div style={{ flex: '1 1 12rem' }}>
                        <label htmlFor="ph-name" className="label">{t('public_holidays_name_en')}</label>
                        <input id="ph-name" className="input" value={draft.name} maxLength={120} onChange={e => setDraft({ ...draft, name: e.target.value })} />
                    </div>
                    <div style={{ flex: '1 1 12rem' }}>
                        <label htmlFor="ph-name-ar" className="label">{t('public_holidays_name_ar')}</label>
                        <input id="ph-name-ar" className="input" dir="rtl" value={draft.nameAr} maxLength={120} onChange={e => setDraft({ ...draft, nameAr: e.target.value })} />
                    </div>
                    <button className="btn btn-primary" disabled={busy || !draft.date || !draft.name.trim()} onClick={save}>{t('save')}</button>
                    {draft.id && <button className="btn btn-secondary" onClick={() => setDraft(EMPTY)}>{t('cancel')}</button>}
                </div>
                {draft.id && <p style={{ margin: '0.6rem 0 0', fontSize: '0.8rem', color: 'var(--text-soft)' }}>{t('public_holidays_move_hint')}</p>}
            </section>

            <section className="glass" style={{ padding: '1.5rem', borderRadius: '1rem' }} aria-labelledby="public-holiday-list">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                    <h3 id="public-holiday-list" style={{ margin: 0, fontSize: '1rem' }}>{year}</h3>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button className="btn btn-secondary" aria-label={t('previous_page')} onClick={() => setYear(year - 1)}>{'‹'}</button>
                        <button className="btn btn-secondary" aria-label={t('next_page')} onClick={() => setYear(year + 1)}>{'›'}</button>
                    </div>
                </div>
                {holidays === null ? <LoadingSpinner /> : holidays.length === 0 ? (
                    <p style={{ margin: 0, color: 'var(--text-soft)' }}>{t('attendance_no_holidays')}</p>
                ) : holidays.map(h => (
                    <div key={h.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.5rem 0', borderTop: '1px solid var(--border)', fontSize: '0.9rem' }}>
                        <span style={{ minWidth: '9rem' }}>{dateText(h.date)}</span>
                        <span style={{ flex: 1 }}>{isRtl && h.nameAr ? h.nameAr : h.name}</span>
                        {h.companiesSkipping > 0 && (
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-soft)' }}>
                                {t('public_holidays_skipping_n').replace('{n}', String(h.companiesSkipping))}
                            </span>
                        )}
                        <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => setDraft({ id: h.id, date: h.date, name: h.name, nameAr: h.nameAr ?? '' })}>{t('edit')}</button>
                        <button className="btn btn-secondary" style={{ fontSize: '0.8rem', color: 'var(--danger-fg)' }} onClick={() => setRemoving(h)}>{t('delete')}</button>
                    </div>
                ))}
            </section>

            <ConfirmModal
                isOpen={!!removing}
                title={t('confirm_action')}
                message={t('public_holidays_delete_confirm').replace('{name}', removing?.name ?? '')}
                confirmText={t('delete')}
                variant="danger"
                onConfirm={async () => {
                    const target = removing
                    if (!target) return
                    try {
                        const res = await fetch(`/api/public-holidays/${target.id}`, { method: 'DELETE' })
                        if (!res.ok) showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
                        await load()
                    } finally { setRemoving(null) }
                }}
                onCancel={() => setRemoving(null)}
            />
        </div>
    )
}
