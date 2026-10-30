'use client'

import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import ConfirmModal from '@/components/ConfirmModal'
import { Button, Card, Row, StatusBadge } from '@/components/ui'
import { refusalText } from '@/lib/cash-advances'

type Switches = { cashAdvancesAllowed: boolean; cashAdvancesOn: boolean }

/**
 * Cash advances' switches, on Company Settings' General tab (CLIENTS_PLAN.md
 * §7.6): the Super Admin allows them for the company, which switches them
 * on, and its Admin switches them off and on again. Neither goes off while
 * anyone holds advance money, and the card says how much is held.
 */
export default function CashAdvancesCard({ companyId, allowed, on, held, superAdmin, readOnly, onSaved }: {
    companyId: string
    allowed: boolean
    on: boolean
    /** What the company's people hold between them. */
    held: number
    superAdmin: boolean
    readOnly: boolean
    onSaved: (next: Partial<Switches>) => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { mutate } = useSWRConfig()
    const [saving, setSaving] = useState(false)
    const [switchingOff, setSwitchingOff] = useState<keyof Switches | null>(null)

    const money = (n: number) => `${n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`
    const holding = held > 0

    const save = async (next: Partial<Switches>) => {
        setSaving(true)
        try {
            const res = await fetch('/api/company-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId, tab: 'general', ...next }),
            })
            const answer = await res.json().catch(() => null)
            if (!res.ok) {
                showToast(refusalText(t, answer), 'error')
                return
            }
            onSaved(next)
            showToast(t('settings_saved_success'), 'success')
            // My cash advance in the side bar, at once.
            void mutate('/api/company-settings/visible')
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    const badge = (value: boolean, yes: string, no: string) => <StatusBadge tone={value ? 'good' : 'neutral'}>{value ? yes : no}</StatusBadge>
    const offButton = (field: keyof Switches, label: string) => (
        <Button size="sm" disabled={readOnly || saving || holding} onClick={() => setSwitchingOff(field)}>{label}</Button>
    )

    return (
        <Card title={t('advances_settings_title')}>
            <p className="ui-card-note">{t('advances_settings_hint')}</p>
            <ul className="ui-rows ui-rows-flush" aria-label={t('advances_settings_title')}>
                {superAdmin && (
                    <Row
                        title={t('advances_allow_label')}
                        detail={t('advances_allow_hint')}
                        end={<>
                            {badge(allowed, t('advances_allowed'), t('advances_not_allowed'))}
                            {allowed
                                ? offButton('cashAdvancesAllowed', t('advances_stop_allowing'))
                                : <Button size="sm" variant="primary" busy={saving} disabled={readOnly} onClick={() => { void save({ cashAdvancesAllowed: true, cashAdvancesOn: true }) }}>{t('advances_allow')}</Button>}
                        </>}
                    />
                )}
                {allowed && (
                    <Row
                        title={t('advances_use_label')}
                        detail={holding ? t('advances_held_note').replace('{amount}', money(held)) : t('advances_use_hint')}
                        end={<>
                            {badge(on, t('advances_on'), t('advances_off_badge'))}
                            {on
                                ? offButton('cashAdvancesOn', t('advances_switch_off'))
                                : <Button size="sm" variant="primary" busy={saving} disabled={readOnly} onClick={() => { void save({ cashAdvancesOn: true }) }}>{t('advances_switch_on')}</Button>}
                        </>}
                    />
                )}
            </ul>
            <ConfirmModal
                isOpen={!!switchingOff}
                title={t(switchingOff === 'cashAdvancesAllowed' ? 'advances_stop_allowing' : 'advances_switch_off')}
                message={t('advances_switch_off_question')}
                confirmText={t(switchingOff === 'cashAdvancesAllowed' ? 'advances_stop_allowing' : 'advances_switch_off')}
                cancelText={t('cancel')}
                variant="warning"
                onConfirm={async () => {
                    if (switchingOff) await save({ [switchingOff]: false })
                    setSwitchingOff(null)
                }}
                onCancel={() => setSwitchingOff(null)}
            />
        </Card>
    )
}
