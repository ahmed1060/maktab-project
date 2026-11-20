'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { HourglassIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, EmptyState, Row, StatusBadge } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { taxEmailsApi } from '@/lib/client-message-pages'

/**
 * The Client portal tab's second card (CLIENT_PORTAL_PLAN.md §4.4, step 11a;
 * DESIGN.md §5.5, A company's client messages; PR 350), the owner's mockup's
 * middle card: whether the client's people are emailed when their tax
 * position is updated. One row saying what's sent, with On or Off and Turn
 * on or Turn off, as the company's other switches are (decided on
 * 2026-11-20, in place of the mockup's toggle). Neither asks first: nothing
 * is lost, and it's turned back here.
 */
export default function TaxEmailsCard({ companyId, superAdmin }: { companyId: string; superAdmin: boolean }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    // The company named, for the Super Admin; their own, which the server reads, for its people.
    const scope = superAdmin ? companyId : null
    const { data, error, isValidating, mutate } = useSWR<{ data: { on: boolean } }>(taxEmailsApi(scope), fetcher)
    const on = data?.data?.on
    const [saving, setSaving] = useState(false)

    const turn = async (next: boolean) => {
        setSaving(true)
        try {
            const res = await fetch(taxEmailsApi(scope), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ on: next }),
            })
            const body = await res.json().catch(() => null)
            if (!res.ok || typeof body?.data?.on !== 'boolean') {
                showToast(typeof body?.error === 'string' && body.error ? body.error : t('error_generic'), 'error')
                return
            }
            // As the server kept it.
            await mutate({ data: { on: body.data.on } }, { revalidate: false })
            showToast(t('settings_saved_success'), 'success')
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card title={t('cmsg_emails_title')}>
            {on === undefined ? (
                error ? (
                    <EmptyState icon={WarningCircleIcon} title={t('cmsg_emails_load_failed')} detail={(error as SWRError).info?.error}
                        action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                ) : (
                    <div role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
                )
            ) : (
                <ul className="ui-rows ui-rows-flush" aria-label={t('cmsg_emails_title')}>
                    <Row
                        title={t('cmsg_emails_label')}
                        detail={t('cmsg_emails_hint')}
                        end={<>
                            <StatusBadge tone={on ? 'good' : 'neutral'}>{t(on ? 'cmsg_emails_on' : 'cmsg_emails_off')}</StatusBadge>
                            {on
                                ? <Button size="sm" busy={saving} onClick={() => { void turn(false) }}>{t('settings_turn_off')}</Button>
                                : <Button size="sm" variant="primary" busy={saving} onClick={() => { void turn(true) }}>{t('settings_turn_on')}</Button>}
                        </>}
                    />
                </ul>
            )}
        </Card>
    )
}
