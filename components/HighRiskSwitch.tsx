'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, ConfirmDialog, Row, StatusBadge } from '@/components/ui'

/**
 * The switch that turns off the high-risk confirmation (ROLES_PLAN.md §6.15,
 * decided on 2026-11-09): on System settings for every company, and on
 * Company settings for one. A row saying whether a code is asked, with Turn
 * off or Turn on beside it for whoever may change it.
 *
 * Turning it off is asked first, saying what stops being asked; its button
 * isn't red, as nothing is lost and it turns on again here. Either way the
 * server asks for an authenticator code once, which StepUpInterceptor asks
 * for and sends again; turned down, the prompt said what it needed, and
 * nothing more is said here.
 */

/** How a save went: done, refused for a reason to say, or quietly, as the code prompt was turned down. */
export type SwitchAnswer = 'saved' | 'quiet' | { error?: string }

/** What a refused save's answer comes to here. */
export function switchRefusal(body: { code?: unknown; error?: unknown } | null | undefined): SwitchAnswer {
    const code = body?.code
    if (code === 'STEP_UP_REQUIRED' || code === 'MFA_ENROL_REQUIRED') return 'quiet'
    return { error: typeof body?.error === 'string' ? body.error : undefined }
}

export default function HighRiskSwitch({ scope, on, offForAll = false, readOnly = false, save }: {
    /** For every company, on System settings, or for one, on Company settings. */
    scope: 'all' | 'company'
    on: boolean
    /** A company's, where the system's is off: there's nothing for it to turn. */
    offForAll?: boolean
    readOnly?: boolean
    save: (next: boolean) => Promise<SwitchAnswer>
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [saving, setSaving] = useState(false)
    const [asking, setAsking] = useState(false)
    const changeable = !readOnly && !offForAll
    const shownOn = on && !offForAll

    const turn = async (next: boolean) => {
        setSaving(true)
        try {
            const answer = await save(next)
            if (answer === 'quiet') return
            if (answer === 'saved') showToast(t('settings_saved_success'), 'success')
            else showToast(answer.error || t('error_generic'), 'error')
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
            setAsking(false)
        }
    }

    return (
        <>
            <ul className="ui-rows ui-rows-flush" aria-label={t('step_up_minutes_label')}>
                <Row
                    title={t('high_risk_ask_label')}
                    detail={t(scope === 'all' ? 'high_risk_all_hint' : 'high_risk_company_hint')}
                    note={offForAll ? t('high_risk_off_for_all') : undefined}
                    end={<>
                        <StatusBadge tone={shownOn ? 'good' : 'neutral'}>{shownOn ? t('high_risk_on') : t('high_risk_off')}</StatusBadge>
                        {changeable && (on
                            ? <Button size="sm" busy={saving} onClick={() => setAsking(true)}>{t('settings_turn_off')}</Button>
                            : <Button size="sm" variant="primary" busy={saving} onClick={() => { void turn(true) }}>{t('settings_turn_on')}</Button>)}
                    </>}
                />
            </ul>
            <ConfirmDialog
                open={asking}
                title={t('high_risk_off_title')}
                body={t(scope === 'all' ? 'high_risk_off_body_all' : 'high_risk_off_body_company')}
                confirmLabel={t('settings_turn_off')}
                onConfirm={() => turn(false)}
                onCancel={() => setAsking(false)}
            />
        </>
    )
}
