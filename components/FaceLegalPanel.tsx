'use client'

import { useState } from 'react'
import useSWR from 'swr'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'
import { apiErrorText } from '@/lib/api-error-text'

/**
 * The company's confirmation that it holds whatever licence biometric
 * processing needs (ATTENDANCE_PLAN.md §10.4), on its Attendance settings.
 * Shown only once face verification exists for the system: before that there
 * is nothing to confirm.
 */
export function useFaceLegal(companyId: string | undefined) {
    return useSWR<{ data: { system: 'OFF' | 'ON' | 'PAUSED'; legalConfirmedAt: string | null } }>(companyId ? `/api/attendance/face/legal?companyId=${companyId}` : null, fetcher)
}

export default function FaceLegalPanel({ companyId, readOnly }: { companyId: string; readOnly: boolean }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const { data, mutate } = useFaceLegal(companyId)
    const [asking, setAsking] = useState<boolean | null>(null)
    if (!data || data.data.system === 'OFF') return null
    const confirmedAt = data.data.legalConfirmedAt

    const save = async (confirmed: boolean) => {
        try {
            const res = await fetch('/api/attendance/face/legal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, confirmed }) })
            const text = await res.text()
            if (!res.ok) return showToast(apiErrorText(text, t('error_generic')), 'error')
            mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally { setAsking(null) }
    }

    return (
        <section className="glass" style={{ padding: '1rem', borderRadius: '1rem', display: 'grid', gap: '0.5rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{t('face_legal_title')}</h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-soft)' }}>{t('face_legal_hint')}</p>
            {data.data.system === 'PAUSED' && <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--warn-fg)' }}>{t('face_sys_state_PAUSED')}</p>}
            <p style={{ margin: 0, fontWeight: 600, color: confirmedAt ? 'var(--ok-fg)' : 'var(--text-soft)' }}>
                {confirmedAt ? t('face_legal_confirmed').replace('{date}', confirmedAt.slice(0, 10)) : t('face_legal_not_confirmed')}
            </p>
            {!readOnly && (
                <div>
                    <button className={confirmedAt ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => setAsking(!confirmedAt)}>
                        {t(confirmedAt ? 'face_legal_withdraw' : 'face_legal_confirm')}
                    </button>
                </div>
            )}
            <ConfirmModal
                isOpen={asking !== null}
                title={t(asking ? 'face_legal_confirm' : 'face_legal_withdraw')}
                message={t(asking ? 'face_legal_confirm_text' : 'face_legal_withdraw_text')}
                variant="warning"
                onConfirm={() => asking !== null && save(asking)}
                onCancel={() => setAsking(null)}
            />
        </section>
    )
}
