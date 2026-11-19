'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { Button, Choice, Dialog, Field, TextInput } from '@/components/ui'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import type { ClientLanguage, ClientPerson } from '@/lib/client-accounts'
import { personRefusal } from '@/lib/client-people'

/**
 * Add person, for People who can sign in (CLIENT_PORTAL_PLAN.md §5.2, step
 * 6c-1, PR 326): a name, an email, and the language they're invited in,
 * Arabic to start, as the office knows its client. Sent, the invitation is
 * emailed in that language. What the server refuses is said where it
 * belongs, in the page's language: a name's or an email's under its field,
 * anything else above the buttons (lib/client-people.ts, personRefusal).
 */
export default function AddClientPerson({ open, client, onClose, onAdded }: {
    open: boolean
    client: { id: string; name: string }
    onClose: () => void
    onAdded: (person: ClientPerson) => void
}) {
    const { t } = useLanguage()
    const formId = useId()
    const form = useRef<HTMLFormElement>(null)
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [language, setLanguage] = useState<ClientLanguage>('ar')
    const [sending, setSending] = useState(false)
    const [errors, setErrors] = useState<{ name?: string; email?: string; other?: string }>({})

    // Opened again, it starts empty: what was typed for one person isn't left for the next.
    useAdjustOnChange([open], () => {
        if (!open) return
        setName(''); setEmail(''); setLanguage('ar'); setErrors({})
    })

    const send = async (e: FormEvent) => {
        e.preventDefault()
        if (sending) return
        const missing = { name: name.trim() ? undefined : t('client_person_name_required'), email: email.trim() ? undefined : t('client_person_email_required') }
        // What's missing, each under its field, with the focus on the first (DESIGN.md §5.3).
        if (missing.name || missing.email) { setErrors(missing); focusFirstWrong(form.current); return }
        setSending(true)
        setErrors({})
        try {
            const res = await fetch('/api/client-accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId: client.id, name, email, language }),
            })
            const answer = await res.json().catch(() => null)
            if (!res.ok || !answer?.data) {
                const refusal = personRefusal(res.status, answer, 'add')
                // The code prompt, turned down: it said what it needed, and what was typed stays.
                if (refusal === 'quiet') return
                if (!refusal) setErrors({ other: answer?.error || t('error_generic') })
                else setErrors({ [refusal.field ?? 'other']: t(refusal.key) })
                if (refusal && refusal.field) focusFirstWrong(form.current)
                return
            }
            onAdded(answer.data as ClientPerson)
        } catch {
            setErrors({ other: t('error_generic') })
        } finally {
            setSending(false)
        }
    }

    return (
        <Dialog
            open={open}
            onClose={() => { if (!sending) onClose() }}
            title={t('client_person_add_title')}
            actions={<>
                <Button type="submit" form={formId} variant="primary" busy={sending}>{t('client_person_send')}</Button>
                <Button onClick={onClose} disabled={sending}>{t('cancel')}</Button>
            </>}
        >
            <form ref={form} id={formId} onSubmit={send} className="ui-dialog-body" noValidate>
                <p className="ui-hint"><bdi>{client.name}</bdi></p>
                <Field label={t('client_person_name')} error={errors.name}>{p => (
                    <TextInput {...p} name="name" value={name} onChange={e => setName(e.target.value)} autoComplete="off" maxLength={100} />
                )}</Field>
                <Field label={t('client_person_email')} hint={t('client_person_email_hint')} error={errors.email}>{p => (
                    <TextInput {...p} name="email" type="email" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" spellCheck={false} />
                )}</Field>
                <Choice
                    legend={t('client_person_language')}
                    name={`${formId}-language`}
                    value={language}
                    onChange={setLanguage}
                    options={[
                        { value: 'ar', label: <span lang="ar">العربية</span> },
                        { value: 'en', label: <span lang="en">English</span> },
                    ]}
                />
                <p className="ui-hint">{t('client_person_language_hint')}</p>
                <p>{t('client_person_note')}</p>
                {errors.other && <span className="ui-error" role="alert">{errors.other}</span>}
            </form>
        </Dialog>
    )
}
