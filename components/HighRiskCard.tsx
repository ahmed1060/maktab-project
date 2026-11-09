'use client'

import { useLanguage } from '@/context/LanguageContext'
import { Card } from '@/components/ui'
import HighRiskSwitch, { switchRefusal, type SwitchAnswer } from '@/components/HighRiskSwitch'

/**
 * The high-risk confirmation, on Company settings' General tab
 * (ROLES_PLAN.md §6.15): its Admin turns it off or on for the company, and
 * the Super Admin can for any company. Where it's off for every company, on
 * System settings, it says so and offers nothing to turn.
 */
export default function HighRiskCard({ companyId, on, offForAll, readOnly, onSaved }: {
    companyId: string
    on: boolean
    offForAll: boolean
    readOnly: boolean
    onSaved: (next: { confirmHighRisk: boolean }) => void
}) {
    const { t } = useLanguage()

    const save = async (next: boolean): Promise<SwitchAnswer> => {
        const res = await fetch('/api/company-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyId, tab: 'general', confirmHighRisk: next }),
        })
        const answer = await res.json().catch(() => null)
        if (!res.ok) return switchRefusal(answer)
        onSaved({ confirmHighRisk: next })
        return 'saved'
    }

    return (
        <Card title={t('step_up_minutes_label')}>
            <p className="ui-card-note">{t('high_risk_company_note')}</p>
            <HighRiskSwitch scope="company" on={on} offForAll={offForAll} readOnly={readOnly} save={save} />
        </Card>
    )
}
