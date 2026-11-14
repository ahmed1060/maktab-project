'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { apiErrorText } from '@/lib/api-error-text'
import { Button, Card, Dialog, Row, StatusBadge } from '@/components/ui'

/**
 * Who sets a company's fingerprint terminals up (ATTENDANCE_PLAN.md §17.10,
 * PR 277): the Super Admin's switch, on the Attendance tab above Fingerprint
 * terminals, for a company holding the Terminals add-on. Off, the Super Admin
 * alone does; on, those in the company holding Set up fingerprint terminals
 * do. Turning it on asks first: what they add counts towards pay. Turning it
 * off doesn't, since it stops nothing already set up.
 */
export default function TerminalsSetupCard({ companyId, on, onSaved }: {
    companyId: string
    on: boolean
    onSaved: (next: { terminalsSetupByCompany: boolean }) => void
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [saving, setSaving] = useState(false)
    const [asking, setAsking] = useState(false)

    /** Whether it saved: a failed save leaves the dialog open, to try again or cancel. */
    const save = async (next: boolean): Promise<boolean> => {
        setSaving(true)
        try {
            const res = await fetch('/api/company-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId, tab: 'attendance', terminalsSetupByCompany: next }),
            })
            if (!res.ok) {
                showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
                return false
            }
            onSaved({ terminalsSetupByCompany: next })
            showToast(t('settings_saved_success'), 'success')
            return true
        } catch {
            showToast(t('error_generic'), 'error')
            return false
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card title={t('att_term_setup_title')}>
            <ul className="ui-rows ui-rows-flush" aria-label={t('att_term_setup_title')}>
                <Row
                    title={t('att_term_setup_label')}
                    detail={t(on ? 'att_term_setup_on_hint' : 'att_term_setup_off_hint')}
                    end={<>
                        <StatusBadge tone={on ? 'good' : 'neutral'}>{t(on ? 'att_term_setup_on_badge' : 'att_term_setup_off_badge')}</StatusBadge>
                        {on
                            ? <Button size="sm" busy={saving} onClick={() => { void save(false) }}>{t('att_term_setup_turn_off')}</Button>
                            : <Button size="sm" variant="primary" disabled={saving} onClick={() => setAsking(true)}>{t('att_term_setup_turn_on')}</Button>}
                    </>}
                />
            </ul>
            {/* The building blocks' dialog: it stays open, its button busy,
                until the switch is saved, and open if saving fails. */}
            <Dialog
                open={asking}
                onClose={() => { if (!saving) setAsking(false) }}
                title={t('att_term_setup_confirm_title')}
                actions={<>
                    <Button onClick={() => setAsking(false)} disabled={saving}>{t('cancel')}</Button>
                    <Button variant="primary" busy={saving} onClick={async () => {
                        if (await save(true)) setAsking(false)
                    }}>{t('att_term_setup_turn_on')}</Button>
                </>}
            >
                <p>{t('att_term_setup_confirm_msg')}</p>
            </Dialog>
        </Card>
    )
}
