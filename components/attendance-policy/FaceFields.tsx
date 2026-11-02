'use client'

import { useFaceLegal } from '@/components/FaceLegalPanel'
import { Field, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'

/**
 * Face verification in the company's policy (ATTENDANCE_PLAN.md §9.5): offered
 * once the system has it and the company has confirmed its legal readiness,
 * with an optional re-verification interval. Hidden while it can't be offered,
 * unless this version already offers it.
 */
export default function FaceFields({ companyId, available, months, error, onChange }: {
    companyId: string
    available: boolean
    months: string
    error?: string
    onChange: (change: { faceVerificationAvailable?: boolean; faceReverifyMonths?: string }) => void
}) {
    const { t } = useLanguage()
    const { data } = useFaceLegal(companyId)
    const offerable = !!data && data.data.system !== 'OFF' && data.data.mobileApp !== false && !!data.data.legalConfirmedAt
    if (!offerable && !available) return null
    return (
        <fieldset className="ui-fieldset">
            <legend className="ui-subsection-title">{t('face_policy_title')}</legend>
            <div className="ui-field-group">
                <label className="ui-choice">
                    <input type="checkbox" className="ui-check" checked={available} onChange={e => onChange({ faceVerificationAvailable: e.target.checked })} />
                    {t('face_policy_available')}
                </label>
                {available && (
                    <Field label={t('face_policy_reverify')} hint={t('face_policy_reverify_hint')} error={error}>{p => (
                        <TextInput {...p} type="number" inputMode="numeric" autoComplete="off" min={1} max={36} value={months}
                            onChange={e => onChange({ faceReverifyMonths: e.target.value })} />
                    )}</Field>
                )}
                {!offerable && <p className="ui-hint">{t('face_policy_not_offerable')}</p>}
            </div>
        </fieldset>
    )
}
