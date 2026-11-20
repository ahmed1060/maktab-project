'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { HourglassIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, ButtonLink, Card, ConfirmDialog, EmptyState, Row } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { MESSAGE_KINDS, MESSAGE_LANGUAGES, type CompanyMessage, type MessageKind, type MessageLanguage } from '@/lib/client-message-template'
import { MESSAGE_NAME, companyMessageHref, companyMessagesApi, nizmoAgainApi, ownLanguages, putBackSince } from '@/lib/client-message-pages'
import type { TranslationKey } from '@/lib/translations'

/**
 * The Client portal tab's card in Company settings (CLIENT_PORTAL_PLAN.md
 * §7.1, step 10c-2; DESIGN.md §5.5, A company's client messages; PR 349),
 * as the owner's mockup draws it (Company messages): a row for each client
 * message on WhatsApp, a line under its name for each language, the
 * company's copy by who changed it and when, or Nizmo's.
 *
 * Change it for this company, or Edit, goes to the message's editor on a
 * page of its own. Use Nizmo's message asks first, then puts back every
 * language the company changed at once, from the times the tab read: one
 * changed since refuses it, and the tab reads them again.
 */

/** Each language, named in the page's language (the audit log's words). */
const LANGUAGE_NAME: Record<MessageLanguage, TranslationKey> = { ar: 'audit_value_AR', en: 'audit_value_EN' }
/** The languages a copy goes from, as the confirmation says them. */
const LANGUAGES_KEY: Record<'ar' | 'en' | 'both', TranslationKey> = { ar: 'cmsg_in_ar', en: 'cmsg_in_en', both: 'cmsg_in_both' }

export default function CompanyMessagesCard({ companyId, superAdmin }: { companyId: string; superAdmin: boolean }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    // The company named, for the Super Admin; their own, which the server reads, for its people.
    const scope = superAdmin ? companyId : null
    const { data, error, isValidating, mutate } = useSWR<{ data: { messages: CompanyMessage[] } }>(companyMessagesApi(scope), fetcher)
    const messages = data?.data?.messages
    const [backing, setBacking] = useState<MessageKind | null>(null)

    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const day = (iso: string) => new Date(iso).toLocaleDateString(intl, { day: 'numeric', month: 'long', year: 'numeric' })
    const name = (kind: MessageKind) => t(MESSAGE_NAME[kind])
    const languagesOf = (kind: MessageKind | null): 'ar' | 'en' | 'both' => {
        const own = kind && messages ? ownLanguages(messages, kind) : []
        return own.length === 1 ? own[0] : 'both'
    }

    // Returned, so the confirmation shows it working until it's done.
    const putBack = async () => {
        const kind = backing
        if (!kind || !messages) return
        try {
            const res = await fetch(nizmoAgainApi(scope, kind), {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ since: putBackSince(messages, kind) }),
            })
            const body = await res.json().catch(() => null)
            if (!res.ok) {
                // Changed since the tab read it: shown as it is now, nothing put back.
                if (body?.code === 'MESSAGE_CHANGED_SINCE') {
                    await mutate()
                    showToast(t('cmsg_company_changed'), 'error')
                    return
                }
                showToast(typeof body?.error === 'string' && body.error ? body.error : t('error_generic'), 'error')
                return
            }
            await mutate()
            showToast(t('cmsg_used_nizmo').replace('{message}', name(kind)), 'success')
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBacking(null)
        }
    }

    const line = (message: CompanyMessage | undefined, language: MessageLanguage) => {
        const said = t(LANGUAGE_NAME[language])
        return message?.own && message.changedAt
            ? t('cmsg_company_own').replace('{language}', said).replace('{name}', message.changedBy ?? '').replace('{date}', day(message.changedAt))
            : t('cmsg_company_uses_nizmo').replace('{language}', said)
    }

    const end = (kind: MessageKind) => {
        const href = companyMessageHref(companyId, superAdmin, kind)
        if (ownLanguages(messages ?? [], kind).length === 0) {
            return (
                <span className="ui-row-actions">
                    <ButtonLink href={href} aria-label={t('cmsg_change_for_company_named').replace('{message}', name(kind))}>{t('cmsg_change_for_company')}</ButtonLink>
                </span>
            )
        }
        return (
            <span className="ui-row-actions">
                <ButtonLink href={href} aria-label={t('cmsg_edit_named').replace('{message}', name(kind))}>{t('edit')}</ButtonLink>
                <Button aria-label={t('cmsg_use_nizmo_named').replace('{message}', name(kind))} onClick={() => setBacking(kind)}>{t('cmsg_use_nizmo')}</Button>
            </span>
        )
    }

    return (
        <Card title={t('cmsg_title')} subtitle={t('cmsg_company_line')}>
            {!messages ? (
                error ? (
                    <EmptyState icon={WarningCircleIcon} title={t('cmsg_load_failed')} detail={(error as SWRError).info?.error}
                        action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                ) : (
                    <div role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
                )
            ) : (
                <>
                    <ul className="ui-rows ui-cmsg-rows" aria-label={t('cmsg_title')}>
                        {MESSAGE_KINDS.map(kind => (
                            <Row
                                key={kind}
                                title={name(kind)}
                                note={MESSAGE_LANGUAGES.map(language => line(messages.find(m => m.kind === kind && m.language === language), language))}
                                end={end(kind)}
                            />
                        ))}
                    </ul>
                    <p className="ui-cmsg-foot">{t('cmsg_company_foot')}</p>
                </>
            )}

            <ConfirmDialog
                open={!!backing}
                danger
                title={t('cmsg_use_nizmo_title').replace('{message}', backing ? name(backing) : '')}
                body={t('cmsg_use_nizmo_body').replace('{languages}', t(LANGUAGES_KEY[languagesOf(backing)]))}
                confirmLabel={t('cmsg_use_nizmo')}
                onConfirm={putBack}
                onCancel={() => setBacking(null)}
            />
        </Card>
    )
}
