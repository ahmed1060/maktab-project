'use client'

import { useLanguage } from '@/context/LanguageContext'
import { Card } from '@/components/ui'
import HighRiskSwitch, { switchRefusal, type SwitchAnswer } from '@/components/HighRiskSwitch'

/**
 * The high-risk confirmation, on Company settings' General tab
 * (ROLES_PLAN.md §6.15): its Admin turns it off or on for the company, and
 * the Super Admin can for any company. Where it's off for every company, on
 * System settings, it says so, with Turn on greyed (PR 242), and the Super
 * Admin's own view links there.
 */
export default function HighRiskCard({ companyId, on, offForAll, readOnly, superAdmin, onSaved }: {
    companyId: string
    on: boolean
    offForAll: boolean
    readOnly: boolean
    superAdmin: boolean
    onSaved: (next: { confirmHighRisk?: boolean; confirmHighRiskForAll?: boolean }) => void
}) {
    const { t } = useLanguage()

    const save = async (next: boolean): Promise<SwitchAnswer> => {
        const res = await fetch('/api/company-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyId, tab: 'general', confirmHighRisk: next }),
        })
        const answer = await res.json().catch(() => null)
        if (!res.ok) {
            const refusal = switchRefusal(answer)
            // Turned off for every company meanwhile: the card greys at once.
            if (typeof refusal === 'object' && refusal.offForAll) onSaved({ confirmHighRiskForAll: false })
            return refusal
        }
        onSaved({ confirmHighRisk: next })
        return 'saved'
    }

    return (
        <Card title={t('step_up_minutes_label')}>
            <p className="ui-card-note">{t('high_risk_company_note')}</p>
            <HighRiskSwitch scope="company" on={on} offForAll={offForAll} readOnly={readOnly} systemSettingsLink={superAdmin} save={save} />
        </Card>
    )
}
