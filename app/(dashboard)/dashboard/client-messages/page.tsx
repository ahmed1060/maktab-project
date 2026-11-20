'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { HourglassIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import { Button, Card, Columns, ConfirmDialog, EmptyState, FieldText, Page, PageHeader, Segmented, Tabs } from '@/components/ui'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useGuardLinks } from '@/lib/useUnsavedChanges'
import { MESSAGE_FIELDS, MESSAGE_MAX_LENGTH, messageLength, messageProblem, type MessageKind, type MessageLanguage, type NizmoMessage } from '@/lib/client-message-template'
import { sampleMessage } from '@/lib/contact-message'
import { NO_EDITS, conflicted, discarded, saved, sinceOf, written, type Edits } from '@/lib/client-message-drafts'
import type { TranslationKey } from '@/lib/translations'

/**
 * Client messages on WhatsApp (CLIENT_PORTAL_PLAN.md §7.1, §12 step 10b;
 * DESIGN.md §5.5; PR 347): Nizmo's own messages, which every company without
 * a copy of its own uses, for the Super Admin to change, as the owner's
 * mockup draws it (Message templates).
 *
 * A tab for each message, then the text with fields put in by buttons and
 * its preview with made-up figures. Each message in each language keeps its
 * own changes until they're saved or discarded; leaving the page with any
 * unsaved asks first. A save says the time of the saved text its changes
 * started from (lib/client-message-drafts.ts), and one someone else changed
 * since is refused: the page then shows it as it is, keeping these changes
 * to save over it. What's typed while a save goes stays, unsaved.
 */

const LANGUAGES: { value: MessageLanguage; label: string; lang: string }[] = [
    { value: 'ar', label: 'العربية', lang: 'ar' },
    { value: 'en', label: 'English', lang: 'en' },
]

/** What the page says of a refusal, by its code (lib/api-errors.ts). */
const REFUSALS: Record<string, TranslationKey> = {
    MESSAGE_EMPTY: 'cmsg_error_empty',
    MESSAGE_TOO_LONG: 'cmsg_error_too_long',
    MESSAGE_FIELD: 'cmsg_error_field',
    MESSAGE_CHANGED_SINCE: 'cmsg_error_changed',
}
const PROBLEMS: Record<'empty' | 'too_long' | 'field', TranslationKey> = { empty: 'cmsg_error_empty', too_long: 'cmsg_error_too_long', field: 'cmsg_error_field' }

const keyOf = (kind: MessageKind, language: MessageLanguage) => `${kind}:${language}`
/** The same, with nothing kept for `key`. */
function without<T>(kept: Record<string, T>, key: string): Record<string, T> {
    const rest = { ...kept }
    delete rest[key]
    return rest
}

export default function ClientMessagesPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const router = useRouter()
    const { data: session, status } = useSession()
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

    const { data, error, isValidating, mutate } = useSWR(isSuperAdmin ? '/api/client-messages' : null, fetcher)
    const messages: NizmoMessage[] | null = data ? data.data?.messages ?? [] : null

    const [kind, setKind] = useState<MessageKind>('contact')
    const [language, setLanguage] = useState<MessageLanguage>(locale === 'ar' ? 'ar' : 'en')
    // Each message's text as it's being changed, by message and language, with the time of the saved text it started from.
    const [edits, setEdits] = useState<Edits>(NO_EDITS)
    const [mistakes, setMistakes] = useState<Record<string, TranslationKey>>({})
    // Raised to start a message's box again from its saved text, as Discard changes does.
    const [starts, setStarts] = useState<Record<string, number>>({})
    const [saving, setSaving] = useState(false)
    const [leaving, setLeaving] = useState<string | null>(null)
    const box = useRef<HTMLDivElement | null>(null)

    const savedText = (k: string) => messages?.find(m => keyOf(m.kind, m.language) === k)?.text
    const dirty = Object.entries(edits.drafts).some(([k, text]) => text !== savedText(k))
    useGuardLinks(dirty, href => setLeaving(href))
    useEffect(() => {
        if (!dirty) return
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [dirty])

    if (status === 'loading') return null
    if (!isSuperAdmin) return <AccessDenied superAdmins />

    const header = <PageHeader title={t('cmsg_title')} subtitle={t('cmsg_hint')} />
    if (!messages) {
        return (
            <Page>
                {header}
                {error ? (
                    <div className="ui-panel">
                        <EmptyState icon={WarningCircleIcon} title={t('cmsg_load_failed')} detail={(error as SWRError).info?.error}
                            action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    </div>
                ) : (
                    <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
                )}
            </Page>
        )
    }

    const key = keyOf(kind, language)
    const current = messages.find(m => m.kind === kind && m.language === language)
    if (!current) return null
    const draft = edits.drafts[key] ?? current.text
    const changed = draft !== current.text
    const mistake = mistakes[key]
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const length = messageLength(draft)
    const fields = MESSAGE_FIELDS[kind].map(f => ({ key: f, label: t(`cmsg_field_${f}` as TranslationKey) }))

    const write = (text: string) => {
        setEdits(e => written(e, key, text, current.changedAt))
        if (mistake) setMistakes(m => without(m, key))
    }
    const startAgain = () => {
        setEdits(e => discarded(e, key))
        setMistakes(m => without(m, key))
        setStarts(s => ({ ...s, [key]: (s[key] ?? 0) + 1 }))
    }
    const wrong = (said: TranslationKey) => {
        setMistakes(m => ({ ...m, [key]: said }))
        box.current?.focus()
    }
    const save = async () => {
        if (saving || !changed) return
        const problem = messageProblem(kind, draft)
        if (problem) return wrong(PROBLEMS[problem.problem])
        // What's typed while it goes isn't in this save, and stays unsaved.
        const sent = draft
        setSaving(true)
        try {
            const res = await fetch(`/api/client-messages/${kind}/${language}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: sent, since: sinceOf(edits, key, current.changedAt) }),
            })
            const body = await res.json().catch(() => null)
            if (!res.ok) {
                const said = typeof body?.code === 'string' ? REFUSALS[body.code] : undefined
                if (body?.code === 'MESSAGE_CHANGED_SINCE') {
                    // Shown as it is now, who changed it and when: a save after this replaces that one.
                    const fresh = await mutate()
                    const now = (fresh?.data?.messages as NizmoMessage[] | undefined)?.find(m => m.kind === kind && m.language === language)
                    if (now) setEdits(e => conflicted(e, key, now.changedAt))
                }
                if (said) return wrong(said)
                return showToast(typeof body?.error === 'string' ? body.error : t('error_generic'), 'error')
            }
            await mutate()
            setEdits(e => saved(e, key, sent, typeof body?.data?.changedAt === 'string' ? body.data.changedAt : null))
            showToast(t('cmsg_saved'), 'success')
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    const note = current.changedAt
        ? t('cmsg_changed').replace('{name}', current.changedBy ?? '').replace('{date}', new Date(current.changedAt).toLocaleDateString(intl, { day: 'numeric', month: 'long', year: 'numeric' }))
        : t('cmsg_never_changed')

    return (
        <Page>
            {header}
            <Tabs label={t('cmsg_tabs')} idPrefix="cmsg" value={kind} onChange={setKind} items={[
                { value: 'contact', label: t('portal_contact_accountant'), controls: 'cmsg-panel' },
                { value: 'claim', label: t('contact_about_claim'), controls: 'cmsg-panel' },
            ]} />
            <div role="tabpanel" id="cmsg-panel" aria-labelledby={`cmsg-${kind}`} className="ui-cmsg-panel">
                <Columns>
                    <Card className="ui-fieldtext-card">
                        <FieldText
                            key={`${key}:${starts[key] ?? 0}`}
                            label={t('cmsg_text')}
                            labelAside={<Segmented label={t('cmsg_language')} value={language} onChange={setLanguage} options={LANGUAGES} fixedOrder />}
                            value={draft}
                            onChange={write}
                            fields={fields}
                            lang={language}
                            dir={language === 'ar' ? 'rtl' : 'ltr'}
                            addLabel={t('fieldtext_add')}
                            error={mistake && t(mistake)}
                            boxRef={box}
                            foot={<>
                                <span className="ui-fieldtext-count" data-over={length > MESSAGE_MAX_LENGTH ? 'true' : undefined}>
                                    {t('fieldtext_count').replace('{count}', length.toLocaleString(intl)).replace('{max}', MESSAGE_MAX_LENGTH.toLocaleString(intl))}
                                </span>
                                <span className="ui-fieldtext-note">{note}</span>
                            </>}
                            actions={<>
                                <Button variant="primary" busy={saving} disabled={!changed} onClick={() => { void save() }}>{t('save')}</Button>
                                <Button disabled={!changed || saving} onClick={startAgain}>{t('cmsg_discard')}</Button>
                            </>}
                        />
                    </Card>
                    <Card title={t('cmsg_preview')}>
                        <div className="ui-chat"><p className="ui-chat-bubble" lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'}>{sampleMessage(kind, language, draft)}</p></div>
                        <p className="ui-chat-note">{t('cmsg_preview_note')}</p>
                    </Card>
                </Columns>
            </div>

            <ConfirmDialog
                open={leaving !== null}
                title={t('settings_unsaved_title')}
                body={t('sys_unsaved_message')}
                confirmLabel={t('settings_unsaved_discard')}
                danger
                onCancel={() => setLeaving(null)}
                onConfirm={() => {
                    const href = leaving
                    setLeaving(null)
                    setEdits(NO_EDITS)
                    if (href) router.push(href)
                }}
            />
        </Page>
    )
}
