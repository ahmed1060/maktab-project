'use client'

import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Card, Field, Select, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { DEFAULT_POWERED_BY_NAME } from '@/lib/branding-defaults'
import { ZONE_SHORTLIST } from '@/lib/timezone'
import type { TranslationKey } from '@/lib/translations'
import { useReportUnsaved } from '@/lib/useUnsavedChanges'

/**
 * System settings' forms (UI_PLAN.md §5 step 5, Operations part 4a): the
 * auto-verify distance, the default calendar, the high-risk confirmation's
 * minutes and the "Powered by" signature, each a card of its own with its
 * own Save. A card is a unit: one button shared by two would belong to
 * neither, and changing a name would resend a distance nobody touched. Each
 * sends only its own fields, so a stale value in one can't overwrite a
 * change somebody just made in another.
 *
 * On the building blocks, as company settings' cards are: each field with
 * its label above it and its range or error below, the first wrong one
 * focused, and Save on the card's end side, off until something changes.
 * They were forms of their own making, with sizes and colours typed in and
 * every mistake a toast.
 */

export type StoredSettings = {
    locationVerifyRadiusMeters: number
    showPoweredBy: boolean
    poweredByName: string | null
    defaultTimezone: string
    stepUpMinutes: number
    brandColour: string
}

type NumberField = 'locationVerifyRadiusMeters' | 'stepUpMinutes'

/** The server's own bounds (lib/validations/system-settings.schema.ts). */
const BOUNDS: Record<NumberField, { min: number; max: number; wrong: TranslationKey; range: TranslationKey }> = {
    locationVerifyRadiusMeters: { min: 1, max: 10000, wrong: 'invalid_radius_value', range: 'sys_range_meters' },
    stepUpMinutes: { min: 5, max: 480, wrong: 'step_up_minutes_invalid', range: 'sys_range_minutes' },
}
const WHOLE = /^\d+$/

/** Which numbers, as typed, are wrong: a whole number within the server's bounds, or not. */
export function settingsErrors(typed: Partial<Record<NumberField, string>>): Partial<Record<NumberField, TranslationKey>> {
    const errors: Partial<Record<NumberField, TranslationKey>> = {}
    for (const [field, text] of Object.entries(typed) as [NumberField, string][]) {
        const n = Number(text.trim())
        if (!WHOLE.test(text.trim()) || n < BOUNDS[field].min || n > BOUNDS[field].max) errors[field] = BOUNDS[field].wrong
    }
    return errors
}

type Saved = { ok: true; data: StoredSettings } | { ok: false; field?: string; message?: string }

/** Sends one card's fields; the settings as saved, or the server's refusal, by field where it names one. */
async function send(patch: Partial<StoredSettings>): Promise<Saved> {
    try {
        const res = await fetch('/api/system-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        })
        const body = await res.json().catch(() => null)
        if (res.ok && body?.success) return { ok: true, data: body.data }
        const details = body?.details as Partial<Record<string, { _errors?: string[] }>> | undefined
        const field = Object.keys(patch).find(k => details?.[k]?._errors?.length)
        return { ok: false, field, message: field ? details?.[field]?._errors?.[0] : body?.error }
    } catch {
        return { ok: false }
    }
}

/** What each card shares: saving its fields, and saying how it went. */
function useCardSave(onSaved: (next: StoredSettings) => void) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [saving, setSaving] = useState(false)
    const form = useRef<HTMLFormElement>(null)
    // To the field said to be wrong, once it says so, as a form's first error is.
    const focusWrong = () => requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
    const save = async (patch: Partial<StoredSettings>, refused: (field: string, message: string) => void): Promise<StoredSettings | null> => {
        setSaving(true)
        try {
            const result = await send(patch)
            if (!result.ok) {
                if (result.field && result.message) {
                    refused(result.field, result.message)
                    focusWrong()
                } else showToast(result.message || t('error_generic'), 'error')
                return null
            }
            onSaved(result.data)
            showToast(t('settings_saved_success'), 'success')
            return result.data
        } finally {
            setSaving(false)
        }
    }
    return { saving, form, focusWrong, save }
}

/** A number of the system's: the auto-verify distance, or the high-risk confirmation's minutes. */
function NumberCard({ field, title, note, label, stored, onSaved }: {
    field: NumberField
    title: string
    note: ReactNode
    label: string
    stored: StoredSettings
    onSaved: (next: StoredSettings) => void
}) {
    const { t, locale } = useLanguage()
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const saved = stored[field]
    // As typed, so the field can be emptied on the way to another number, and
    // said to be wrong rather than quietly sent as 0.
    const [text, setText] = useState(String(saved))
    const [error, setError] = useState<string>()
    const { saving, form, focusWrong, save } = useCardSave(onSaved)
    const dirty = !(WHOLE.test(text.trim()) && Number(text.trim()) === saved)
    useReportUnsaved(field, dirty)
    const { min, max, range } = BOUNDS[field]

    const submit = async (e: FormEvent) => {
        e.preventDefault()
        const wrong = settingsErrors({ [field]: text })[field]
        if (wrong) {
            setError(t(wrong))
            focusWrong()
            return
        }
        const next = await save({ [field]: Number(text.trim()) }, (_, message) => setError(message))
        // What was saved, 50 where "050" was typed.
        if (next) setText(String(next[field]))
    }

    return (
        <Card title={title}>
            <p className="ui-card-note">{note}</p>
            <form ref={form} className="ui-card-form" noValidate onSubmit={submit}>
                <Field label={label} hint={t(range).replace('{min}', num(min)).replace('{max}', num(max))} error={error}>{p => (
                    <TextInput {...p} name={field} type="number" inputMode="numeric" min={min} max={max} autoComplete="off"
                        value={text} onChange={e => { setText(e.target.value); setError(undefined) }} />
                )}</Field>
                <div className="ui-card-actions">
                    <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>{t('save')}</Button>
                </div>
            </form>
        </Card>
    )
}

/** How far from the task's place a submitted location is approved by itself, for companies that turn it on. */
export function LocationCard({ stored, onSaved }: { stored: StoredSettings; onSaved: (next: StoredSettings) => void }) {
    const { t } = useLanguage()
    return <NumberCard field="locationVerifyRadiusMeters" title={t('location_verification_settings')} note={t('location_verify_radius_hint')}
        label={t('location_verify_radius_label')} stored={stored} onSaved={onSaved} />
}

/** How long a high-risk action's authenticator code lasts (ROLES_PLAN.md §6.15). */
export function StepUpCard({ stored, onSaved }: { stored: StoredSettings; onSaved: (next: StoredSettings) => void }) {
    const { t } = useLanguage()
    return <NumberCard field="stepUpMinutes" title={t('step_up_minutes_label')} note={t('step_up_minutes_hint')}
        label={t('sys_step_up_minutes')} stored={stored} onSaved={onSaved} />
}

/**
 * The calendar of anybody with no company, such as a Super Admin. Its own
 * card rather than a field on the location's: it decides which month a
 * record belongs to, which has nothing to do with how far from a place
 * somebody stood. Picked from the zones a company's calendar is.
 */
export function CalendarCard({ stored, onSaved }: { stored: StoredSettings; onSaved: (next: StoredSettings) => void }) {
    const { t } = useLanguage()
    const [zone, setZone] = useState(stored.defaultTimezone)
    const [error, setError] = useState<string>()
    const { saving, form, save } = useCardSave(onSaved)
    const dirty = zone !== stored.defaultTimezone
    useReportUnsaved('defaultTimezone', dirty)
    // A zone already stored but not on the list stays selectable, so opening
    // this page can't quietly change one set through the API.
    const zones = [...(ZONE_SHORTLIST.includes(stored.defaultTimezone) ? [] : [stored.defaultTimezone]), ...ZONE_SHORTLIST].map(z => ({ value: z, label: z }))

    const submit = async (e: FormEvent) => {
        e.preventDefault()
        await save({ defaultTimezone: zone }, (_, message) => setError(message))
    }

    return (
        <Card title={t('default_timezone_label')}>
            <p className="ui-card-note">{t('default_timezone_hint')}</p>
            <form ref={form} className="ui-card-form" noValidate onSubmit={submit}>
                <Field label={t('sys_timezone')} error={error}>
                    {/* Zone names are identifiers, not words: a page translator leaves them as they are. */}
                    {p => <Select {...p} name="defaultTimezone" translate="no" options={zones} value={zone} onChange={e => { setZone(e.target.value); setError(undefined) }} />}
                </Field>
                <div className="ui-card-actions">
                    <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>{t('save')}</Button>
                </div>
            </form>
        </Card>
    )
}

/**
 * The "Powered by" signature in the corner of every dashboard page: whether
 * it's shown, the name it shows, and what it will look like before it's
 * saved. Off, the name is kept and still shown, only not to be changed: the
 * field vanishing would suggest the name was lost.
 */
export function SignatureCard({ stored, onSaved }: { stored: StoredSettings; onSaved: (next: StoredSettings) => void }) {
    const { t, locale } = useLanguage()
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const [shown, setShown] = useState(stored.showPoweredBy)
    const [name, setName] = useState(stored.poweredByName ?? '')
    const [error, setError] = useState<string>()
    const { saving, form, save } = useCardSave(onSaved)
    const dirty = shown !== stored.showPoweredBy || name !== (stored.poweredByName ?? '')
    useReportUnsaved('signature', dirty)
    const NAME_MAX = 40

    const submit = async (e: FormEvent) => {
        e.preventDefault()
        // Trimmed, and the default for a field cleared by accident, rather
        // than "Powered by" followed by nothing.
        const next = await save({ showPoweredBy: shown, poweredByName: name.trim() || DEFAULT_POWERED_BY_NAME }, (_, message) => setError(message))
        if (next) setName(next.poweredByName ?? '')
    }

    return (
        <Card title={t('sys_signature_title')}>
            <p className="ui-card-note">{t('powered_by_hint')}</p>
            <form ref={form} className="ui-card-form" noValidate onSubmit={submit}>
                <div className="ui-field">
                    <label className="ui-choice">
                        <input type="checkbox" className="ui-check" name="showPoweredBy" checked={shown} onChange={e => setShown(e.target.checked)} />
                        {t('show_powered_by_label')}
                    </label>
                </div>
                <Field label={t('powered_by_name_label')} hint={t('ui_characters_used').replace('{used}', num(name.length)).replace('{max}', num(NAME_MAX))} error={error}>{p => (
                    <TextInput {...p} name="poweredByName" dir="auto" maxLength={NAME_MAX} autoComplete="off" placeholder={DEFAULT_POWERED_BY_NAME}
                        value={name} disabled={!shown} onChange={e => { setName(e.target.value); setError(undefined) }} />
                )}</Field>
                {/* What it will look like, so it can be checked before it's saved. */}
                <figure className="ui-signature-preview" data-hidden={!shown || undefined}>
                    <figcaption className="ui-hint">{t('sys_signature_preview')}</figcaption>
                    {shown
                        ? <span className="ui-signature"><span className="ui-signature-by">{t('powered_by')}</span><span className="ui-signature-name">{name.trim() || DEFAULT_POWERED_BY_NAME}</span></span>
                        : <span className="ui-hint">{t('powered_by_hidden')}</span>}
                </figure>
                <div className="ui-card-actions">
                    <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>{t('save')}</Button>
                </div>
            </form>
        </Card>
    )
}
