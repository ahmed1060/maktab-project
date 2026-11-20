'use client'
import { useRef, useState, type FormEvent } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, Card, Field, TextInput } from '@/components/ui'
import { apiErrorText } from '@/lib/api-error-text'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { whatsappNumber } from '@/lib/whatsapp-number'

/**
 * A person's WhatsApp number, for their clients (CLIENT_PORTAL_PLAN.md §7,
 * §12 step 9a; DESIGN.md §5.5; PR 340), as the owner's mockup draws it: a
 * card of its own on their profile's form, Contacting clients, with its own
 * Save, so the number is saved without the rest of the profile. The profile
 * shows it where lib/profile-access.ts says (`whatsapp`).
 *
 * The number is read as the server reads it (lib/whatsapp-number.ts): one
 * that isn't one is said under the field before anything is sent, and the
 * saved one is shown as it's kept, with its country code. Emptied and
 * saved, it's gone.
 */
export function WhatsAppCard({ userId, saved }: { userId: string; saved: string | null }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [value, setValue] = useState(saved ?? '')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const field = useRef<HTMLInputElement>(null)

    // The profile loaded again: the number as it's now kept.
    useAdjustOnChange([saved], () => {
        setValue(saved ?? '')
        setError(null)
    })

    const refuse = (message: string) => {
        setError(message)
        field.current?.focus()
    }

    const save = async (event: FormEvent) => {
        event.preventDefault()
        const typed = whatsappNumber(value)
        if (!typed.ok) return refuse(t('profile_whatsapp_invalid'))
        setError(null)
        setBusy(true)
        try {
            const res = await fetch('/api/users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: userId, whatsappNumber: typed.number }),
            })
            if (!res.ok) {
                const text = await res.text()
                let code: unknown = null
                try { code = JSON.parse(text)?.code } catch { /* not JSON: said as it came, or the card's own words */ }
                if (code === 'WHATSAPP_NUMBER_INVALID') return refuse(t('profile_whatsapp_invalid'))
                showToast(apiErrorText(text, t('profile_whatsapp_failed')), 'error')
                return
            }
            setValue(typed.number ?? '')
            showToast(t(typed.number ? 'profile_whatsapp_saved' : 'profile_whatsapp_removed'), 'success')
        } catch {
            showToast(t('profile_whatsapp_failed'), 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Card title={t('profile_whatsapp_title')}>
            <form className="ui-form" noValidate onSubmit={save}>
                <Field label={t('profile_whatsapp_label')} hint={t('profile_whatsapp_hint')} error={error}>
                    {control => (
                        <TextInput
                            {...control}
                            ref={field}
                            name="whatsappNumber"
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            dir="ltr"
                            spellCheck={false}
                            placeholder="01xxxxxxxxx"
                            value={value}
                            onChange={event => { setValue(event.target.value); if (error) setError(null) }}
                        />
                    )}
                </Field>
                <div className="ui-whatsapp-note">
                    <p>{t('profile_whatsapp_note')}</p>
                    <p className="ui-whatsapp-note-none">{t('profile_whatsapp_none')}</p>
                </div>
                <div className="ui-form-actions">
                    <Button type="submit" variant="primary" busy={busy}>{t('save')}</Button>
                </div>
            </form>
        </Card>
    )
}
