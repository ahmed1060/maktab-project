'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { apiErrorText } from '@/lib/api-error-text'
import { Button, Card, Dialog, EmptyState, StatusBadge } from '@/components/ui'

/**
 * The company's confirmation that it holds whatever licence biometric
 * processing needs (ATTENDANCE_PLAN.md §10.4), on its Attendance settings.
 * Shown only once face verification exists for the system: before that there
 * is nothing to confirm.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 3c).
 */
export function useFaceLegal(companyId: string | undefined) {
    return useSWR<{ data: { system: 'OFF' | 'ON' | 'PAUSED'; mobileApp: boolean; legalConfirmedAt: string | null } }>(companyId ? `/api/attendance/face/legal?companyId=${companyId}` : null, fetcher)
}

export default function FaceLegalPanel({ companyId, readOnly }: { companyId: string; readOnly: boolean }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { data, error, isValidating, mutate } = useFaceLegal(companyId)
    // Confirming (true) or withdrawing (false); null while nothing is asked.
    const [asking, setAsking] = useState<boolean | null>(null)
    const [busy, setBusy] = useState(false)

    if (error && ((error as SWRError).status === 403 || (error as SWRError).status === 404)) return null
    if (error) return (
        <div className="ui-panel">
            <EmptyState icon={WarningCircleIcon} title={t('face_legal_load_failed')} detail={(error as SWRError).info?.error}
                action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
        </div>
    )
    // Face verification is part of the Mobile App add-on: nothing to confirm without it.
    if (!data || data.data.system === 'OFF' || data.data.mobileApp === false) return null
    const confirmedAt = data.data.legalConfirmedAt
    // The day it was confirmed, as the page's language writes a date.
    const dateText = (iso: string) => new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

    /** Saves it; the dialog stays open, its button busy, until it's done. */
    const save = async (confirmed: boolean) => {
        setBusy(true)
        try {
            const res = await fetch('/api/attendance/face/legal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, confirmed }) })
            const text = await res.text()
            if (!res.ok) {
                showToast(apiErrorText(text, t('error_generic')), 'error')
                return
            }
            setAsking(null)
            await mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Card
            title={t('face_legal_title')}
            tone={data.data.system === 'PAUSED' ? 'waiting' : undefined}
            actions={!readOnly && (
                <Button variant={confirmedAt ? 'secondary' : 'primary'} onClick={() => setAsking(!confirmedAt)}>
                    {t(confirmedAt ? 'face_legal_withdraw' : 'face_legal_confirm')}
                </Button>
            )}
        >
            <p>
                <StatusBadge tone={confirmedAt ? 'good' : 'neutral'}>
                    {confirmedAt ? t('face_legal_confirmed').replace('{date}', dateText(confirmedAt)) : t('face_legal_not_confirmed')}
                </StatusBadge>
            </p>
            {data.data.system === 'PAUSED' && <p>{t('face_sys_state_PAUSED')}</p>}
            <p className="ui-card-note">{t('face_legal_hint')}</p>

            {/* Confirming records who and when; withdrawing stops face checks at once. Both are asked first. */}
            <Dialog
                open={asking !== null}
                onClose={() => { if (!busy) setAsking(null) }}
                title={t(asking ? 'face_legal_confirm_title' : 'face_legal_withdraw_title')}
                actions={<>
                    <Button onClick={() => setAsking(null)} disabled={busy}>{t('cancel')}</Button>
                    <Button variant={asking ? 'primary' : 'danger'} busy={busy} onClick={() => { if (asking !== null) void save(asking) }}>
                        {t(asking ? 'face_legal_confirm' : 'face_legal_withdraw')}
                    </Button>
                </>}
            >
                <p>{t(asking ? 'face_legal_confirm_text' : 'face_legal_withdraw_text')}</p>
            </Dialog>
        </Card>
    )
}
