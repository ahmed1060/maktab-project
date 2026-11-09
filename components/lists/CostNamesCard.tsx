'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSWRConfig } from 'swr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, Card, Row, StatusBadge } from '@/components/ui'
import { countOf } from '@/lib/plural'

/**
 * Cost names, on Company Settings' General tab (CLIENTS_PLAN.md §6.9): the
 * company keeps a cost's name to its saved list, or lets it be typed, as
 * before. Switched on only once the list holds a name, or nobody could add
 * a cost; switched off whatever it holds.
 */
export default function CostNamesCard({ companyId, on, saved, superAdmin, readOnly, onSaved }: {
    companyId: string
    on: boolean
    /** The cost names on its saved list, not archived. */
    saved: number
    superAdmin: boolean
    readOnly: boolean
    onSaved: (next: { costNamesFromListOnly: boolean }) => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { mutate } = useSWRConfig()
    const [saving, setSaving] = useState(false)
    const none = saved === 0

    const save = async (next: boolean) => {
        setSaving(true)
        try {
            const res = await fetch('/api/company-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId, tab: 'general', costNamesFromListOnly: next }),
            })
            const answer = await res.json().catch(() => null)
            if (!res.ok) {
                showToast(answer?.code === 'COST_NAMES_NONE_SAVED' ? t('cost_names_none_saved') : answer?.error || t('error_generic'), 'error')
                return
            }
            onSaved({ costNamesFromListOnly: next })
            showToast(t('settings_saved_success'), 'success')
            // A task's Add cost, at once.
            void mutate('/api/company-settings/visible')
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    // How many names there are to pick from, and, with none, where to add one:
    // the company's own Saved lists. A Super Admin's is the company picked
    // above, which may be another.
    const onList = none
        ? <>{t('cost_names_none_saved')}{!superAdmin && <> <Link className="ui-link" href="/dashboard/lists">{t('saved_lists_title')}</Link></>}</>
        : t('cost_names_on_list').replace('{names}', countOf(t, locale, saved, 'names'))

    return (
        <Card title={t('cost_names_settings_title')}>
            <p className="ui-card-note">{t('cost_names_settings_hint')}</p>
            <ul className="ui-rows ui-rows-flush" aria-label={t('cost_names_settings_title')}>
                <Row
                    title={t('cost_names_list_only_label')}
                    detail={t('cost_names_list_only_hint')}
                    note={onList}
                    end={<>
                        <StatusBadge tone={on ? 'good' : 'neutral'}>{on ? t('advances_on') : t('advances_off_badge')}</StatusBadge>
                        {!readOnly && (on
                            ? <Button size="sm" busy={saving} onClick={() => { void save(false) }}>{t('settings_turn_off')}</Button>
                            : <Button size="sm" variant="primary" busy={saving} disabled={none} onClick={() => { void save(true) }}>{t('settings_turn_on')}</Button>)}
                    </>}
                />
            </ul>
        </Card>
    )
}
