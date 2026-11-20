'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Columns, ConfirmDialog, FieldText, Segmented, Tabs } from '@/components/ui'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import { useGuardLinks } from '@/lib/useUnsavedChanges'
import { MESSAGE_FIELDS, MESSAGE_MAX_LENGTH, messageLength, messageProblem, type MessageKind, type MessageLanguage, type NizmoMessage } from '@/lib/client-message-template'
import { sampleMessage } from '@/lib/contact-message'
import { MESSAGE_NAME } from '@/lib/client-message-pages'
import { NO_EDITS, boxOf, conflicted, discarded, saved, sinceOf, written, type Edits } from '@/lib/client-message-drafts'
import type { TranslationKey } from '@/lib/translations'

/**
 * The client messages' editor (CLIENT_PORTAL_PLAN.md §7.1; DESIGN.md §5.5,
 * Client messages on WhatsApp): the Super Admin's for Nizmo's own (step
 * 10b, PR 347), and a company's for its own copy of one, on a page of its
 * own (step 10c-2, PR 349).
 *
 * A tab for each message where it edits more than one, then the text with
 * fields put in by buttons and its preview with made-up figures. Each
 * message in each language keeps its own changes until they're saved or
 * discarded; leaving the page with any unsaved asks first. A save says the
 * time of the saved text its changes started from (lib/client-message-drafts.ts),
 * and one someone else changed since is refused: the page then shows it as
 * it is, keeping these changes to save over it. What's typed while a save
 * goes stays, unsaved.
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

/** A message as the editor reads it: Nizmo's, or a company's, its own copy or Nizmo's. */
export type EditedMessage = NizmoMessage & { own?: boolean }

export default function MessageEditor({ messages, kinds, saveUrl, reload, noteOf, savedSay }: {
    messages: EditedMessage[]
    /** The messages it edits: a tab for each where there's more than one. */
    kinds: readonly MessageKind[]
    /** Where a message in a language is saved. */
    saveUrl: (kind: MessageKind, language: MessageLanguage) => string
    /** Reads the messages again, giving them as they are now. */
    reload: () => Promise<EditedMessage[] | undefined>
    /** The line under the buttons: whose text it is, who changed it and when, given the day in the page's words. */
    noteOf: (message: EditedMessage, day: string | null) => string
    /** What a save says when it's kept. */
    savedSay: TranslationKey
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const router = useRouter()

    const [kind, setKind] = useState<MessageKind>(kinds[0])
    const [language, setLanguage] = useState<MessageLanguage>(locale === 'ar' ? 'ar' : 'en')
    // Each message's text as it's being changed, by message and language, with the time of the saved text it started from.
    const [edits, setEdits] = useState<Edits>(NO_EDITS)
    const [mistakes, setMistakes] = useState<Record<string, TranslationKey>>({})
    // Raised to start a message's box again from its saved text, as Discard changes does.
    const [starts, setStarts] = useState<Record<string, number>>({})
    const [saving, setSaving] = useState(false)
    const [leaving, setLeaving] = useState<string | null>(null)
    const box = useRef<HTMLDivElement | null>(null)

    const savedText = (k: string) => messages.find(m => keyOf(m.kind, m.language) === k)?.text
    const dirty = Object.entries(edits.drafts).some(([k, text]) => text !== savedText(k))
    useGuardLinks(dirty, href => setLeaving(href))
    useEffect(() => {
        if (!dirty) return
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [dirty])

    const key = keyOf(kind, language)
    const current = messages.find(m => m.kind === kind && m.language === language)
    if (!current) return null
    const draft = edits.drafts[key] ?? current.text
    const changed = draft !== current.text
    const mistake = mistakes[key]
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const length = messageLength(draft)
    const fields = MESSAGE_FIELDS[kind].map(f => ({ key: f, label: t(`cmsg_field_${f}` as TranslationKey) }))
    // The saved text the box shows: its time, and the text too, as a company
    // using Nizmo's has no time of its own that moves when the Super Admin
    // changes Nizmo's (PR 349).
    const version = `${current.changedAt ?? 'never'}|${current.text}`

    const write = (text: string) => {
        setEdits(e => written(e, key, text, current.changedAt, version))
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
            const res = await fetch(saveUrl(kind, language), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: sent, since: sinceOf(edits, key, current.changedAt) }),
            })
            const body = await res.json().catch(() => null)
            if (!res.ok) {
                const said = typeof body?.code === 'string' ? REFUSALS[body.code] : undefined
                if (body?.code === 'MESSAGE_CHANGED_SINCE') {
                    // Shown as it is now, who changed it and when: a save after this replaces that one.
                    const fresh = await reload()
                    const now = fresh?.find(m => m.kind === kind && m.language === language)
                    if (now) setEdits(e => conflicted(e, key, now.changedAt))
                }
                if (said) return wrong(said)
                return showToast(typeof body?.error === 'string' ? body.error : t('error_generic'), 'error')
            }
            await reload()
            setEdits(e => saved(e, key, sent, typeof body?.data?.changedAt === 'string' ? body.data.changedAt : null))
            showToast(t(savedSay), 'success')
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    const day = current.changedAt ? new Date(current.changedAt).toLocaleDateString(intl, { day: 'numeric', month: 'long', year: 'numeric' }) : null
    const tabbed = kinds.length > 1

    return (
        <>
            {tabbed && (
                <Tabs label={t('cmsg_tabs')} idPrefix="cmsg" value={kind} onChange={setKind}
                    items={kinds.map(k => ({ value: k, label: t(MESSAGE_NAME[k]), controls: 'cmsg-panel' }))} />
            )}
            <div role={tabbed ? 'tabpanel' : undefined} id={tabbed ? 'cmsg-panel' : undefined} aria-labelledby={tabbed ? `cmsg-${kind}` : undefined} className="ui-cmsg-panel">
                <Columns>
                    <Card className="ui-fieldtext-card">
                        <FieldText
                            // Started again on Discard changes, and when a newer saved text is read while nothing is unsaved.
                            key={`${key}:${starts[key] ?? 0}:${boxOf(edits, key, version)}`}
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
                                <span className="ui-fieldtext-note">{noteOf(current, day)}</span>
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
        </>
    )
}
