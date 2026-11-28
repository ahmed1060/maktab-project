'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { apiErrorText } from '@/lib/api-error-text'
import { Button, Card, Row, StatusBadge } from '@/components/ui'

/**
 * Permission hours left (LATER_CHANGES_PLAN.md §7.18; DESIGN.md §5.5): a
 * company's one switch, on the Attendance tab under Attendance policy, for
 * whether each person sees what's left of their own permission hours. Off,
 * the pages aren't sent it: the Attendance page's tile, the Requests page's
 * Permission hours, asking for permission and the check-in page's late
 * arrival. A request is still held to the policy.
 *
 * One row with the On or Off badge and Turn off or Turn on, as the
 * company's other switches are. Neither asks first: nothing is lost, and
 * it's turned back here.
 */
export default function PermissionLeftCard({ companyId, on, readOnly = false, onSaved }: {
    companyId: string
    on: boolean
    /** Shown, not changed: someone who may only look at the tab. */
    readOnly?: boolean
    onSaved: (next: { permissionLeftShown: boolean }) => void
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [saving, setSaving] = useState(false)

    const save = async (next: boolean) => {
        setSaving(true)
        try {
            const res = await fetch('/api/company-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId, tab: 'attendance', permissionLeftShown: next }),
            })
            if (!res.ok) {
                showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
                return
            }
            onSaved({ permissionLeftShown: next })
            showToast(t('settings_saved_success'), 'success')
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card title={t('perm_left_title')}>
            <ul className="ui-rows ui-rows-flush" aria-label={t('perm_left_title')}>
                <Row
                    title={t('perm_left_label')}
                    // In one piece: a row's second line sets its pieces apart.
                    detail={<span>{t(on ? 'perm_left_on_hint' : 'perm_left_off_hint')}</span>}
                    end={<>
                        <StatusBadge tone={on ? 'good' : 'neutral'}>{t(on ? 'perm_left_on_badge' : 'perm_left_off_badge')}</StatusBadge>
                        {!readOnly && (on
                            ? <Button size="sm" busy={saving} onClick={() => { void save(false) }}>{t('settings_turn_off')}</Button>
                            : <Button size="sm" variant="primary" busy={saving} onClick={() => { void save(true) }}>{t('settings_turn_on')}</Button>)}
                    </>}
                />
            </ul>
        </Card>
    )
}
