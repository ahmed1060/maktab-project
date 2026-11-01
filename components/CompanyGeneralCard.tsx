'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, Card, Row, StatusBadge } from '@/components/ui'

/**
 * The company's general settings: whether a task's submitted location is
 * checked automatically (Company Settings → General). On the building
 * blocks (UI_PLAN.md §5 step 5, company settings part 1): a row saying
 * whether it's on, with a button to turn it off or on, as the cash advances
 * beside it say theirs.
 */
export default function CompanyGeneralCard({ companyId, autoVerifyLocation, onSaved, readOnly = false }: {
    companyId: string
    autoVerifyLocation: boolean
    onSaved: (next: { autoVerifyLocation: boolean }) => void
    /** Shown, not changed: someone who holds settings.view without settings.edit. */
    readOnly?: boolean
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
                body: JSON.stringify({ companyId, tab: 'general', autoVerifyLocation: next }),
            })
            if (res.ok) {
                onSaved({ autoVerifyLocation: next })
                showToast(t('settings_saved_success'), 'success')
            } else {
                const data = await res.json().catch(() => ({}))
                showToast(data.error || t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card title={t('settings_task_locations')}>
            <ul className="ui-rows ui-rows-flush" aria-label={t('settings_task_locations')}>
                <Row
                    title={t('auto_verify_location_label')}
                    detail={t('auto_verify_location_hint')}
                    end={<>
                        <StatusBadge tone={autoVerifyLocation ? 'good' : 'neutral'}>{t(autoVerifyLocation ? 'advances_on' : 'advances_off_badge')}</StatusBadge>
                        {/* A button, not a box that saves when ticked: it says what it does,
                            and only it acts, never the row's text around it. */}
                        {!readOnly && (
                            <Button size="sm" variant={autoVerifyLocation ? 'secondary' : 'primary'} busy={saving} onClick={() => { void save(!autoVerifyLocation) }}>
                                {t(autoVerifyLocation ? 'settings_turn_off' : 'settings_turn_on')}
                            </Button>
                        )}
                    </>}
                />
            </ul>
        </Card>
    )
}
