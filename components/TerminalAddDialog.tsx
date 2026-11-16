'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { addressLines, connectionChoices, hasOfficeAddress, hikvisionSettings, zktecoSettings, type TerminalConnection, type TerminalProtocol } from '@/lib/attendance/terminal-connections'
import { Button, Choice, Dialog, DialogActions, Field, Select, TextArea, TextInput } from '@/components/ui'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { CodeBox, ModelNotes, Sentence, type GuideBrand } from '@/components/TerminalSetupGuide'

/**
 * Adding a terminal by hand, and what to set on one that sends its scans
 * straight to Nizmo (ATTENDANCE_PLAN.md §17.7, PR 292): a Hikvision
 * terminal's secret address, shown once, and a ZKTeco terminal's settings,
 * with nothing secret in them, and the office's internet address it's let
 * in from (§17.3, PR 297). And a terminal moved to its other way of
 * connecting (PR 298).
 */

type Mode = 'ANY' | 'ENTRANCE' | 'EXIT'
const MODES: Mode[] = ['ANY', 'ENTRANCE', 'EXIT']
const MODE_LABEL = { ANY: 'audit_value_ANY', ENTRANCE: 'audit_value_ENTRANCE', EXIT: 'audit_value_EXIT' } as const
const NOT_BUILT = { AGENT: 'att_term_connection_agent_not_built', DIRECT: 'att_term_connection_direct_not_built' } as const

export type AddedTerminal = { name: string; serialNumber: string; brandId: string; mode: Mode; connection: TerminalConnection; officeAddresses?: string[] }

/**
 * Add a terminal: its name, its brand, its serial number, how it reads
 * scans, and how it connects.
 *
 * How it connects follows the brand: the ways listed are the ones this
 * company may pick (straight to Nizmo only where the Super Admin has turned
 * it on), and one that isn't built for the brand's protocol yet stays
 * listed, greyed, with why beside the group (DESIGN.md §5.3). Where none
 * can be picked, Add stays, greyed, with why beside it (§5.2): the server
 * refuses the same.
 *
 * A ZKTeco terminal straight to Nizmo is let in from its office's internet
 * address alone, so that is asked for, one per line, and needed (PR 297).
 * Whether each line is an address is the server's to say.
 */
export function TerminalAddDialog({ brands, directAllowed, busy, onClose, onSubmit }: {
    /** The Super Admin's brands, not retired. */
    brands: GuideBrand[]
    directAllowed: boolean
    busy: boolean
    onClose: () => void
    onSubmit: (terminal: AddedTerminal) => Promise<void>
}) {
    const { t } = useLanguage()
    const formRef = useRef<HTMLFormElement>(null)
    const noneId = useId()
    const [name, setName] = useState('')
    const [serialNumber, setSerialNumber] = useState('')
    const [brandId, setBrandId] = useState('')
    const [mode, setMode] = useState<Mode>('ANY')
    const [picked, setPicked] = useState<TerminalConnection | ''>('')
    const [office, setOffice] = useState('')
    const [errors, setErrors] = useState<{ name?: string; serialNumber?: string; brand?: string; office?: string }>({})

    const brand = brands.find(b => b.id === brandId) ?? null
    const choices = brand ? connectionChoices(brand.protocol, directAllowed) : []
    const built = choices.filter(c => c.built).map(c => c.connection)
    // The way picked, while the brand has it; with one way only, that one, without asking.
    const connection: TerminalConnection | '' = picked && built.includes(picked) ? picked : built.length === 1 ? built[0] : ''
    const blocked = !!brand && built.length === 0
    // Asked for only where it's let in from there (PR 297): what's typed for another stays, unsent, should the brand or way change back.
    const officeAsked = !!brand && !!connection && hasOfficeAddress({ protocol: brand.protocol, connection })
    const whyNot = choices.filter(c => !c.built).map(c => t(NOT_BUILT[c.connection])).join(' ')

    const submit = async (e: FormEvent) => {
        e.preventDefault()
        if (blocked) return
        const wrong = {
            name: name.trim() ? undefined : t('att_term_device_name_required'),
            brand: brand ? undefined : t('att_term_brand_required'),
            serialNumber: serialNumber.trim() ? undefined : t('att_term_serial_required'),
            office: officeAsked && addressLines(office).length === 0 ? t('att_term_office_required') : undefined,
        }
        setErrors(wrong)
        if (wrong.name || wrong.brand || wrong.serialNumber || wrong.office || !brand || !connection) { focusFirstWrong(formRef.current); return }
        await onSubmit({ name: name.trim(), serialNumber: serialNumber.trim(), brandId: brand.id, mode, connection, ...(officeAsked && { officeAddresses: addressLines(office) }) })
    }

    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t('att_term_add_device')}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={submit}>
                <Field label={t('att_term_device_name')} error={errors.name}>{p => (
                    <TextInput {...p} name="name" autoComplete="off" maxLength={80} value={name} onChange={e => { setName(e.target.value); setErrors(x => ({ ...x, name: undefined })) }} />
                )}</Field>
                <Field label={t('att_term_brand')} hint={t('att_term_add_brand_hint')} error={errors.brand}>{p => (
                    // Brands are names as printed: never machine-translated.
                    <Select {...p} name="brand" translate="no" value={brandId} onChange={e => { setBrandId(e.target.value); setErrors(x => ({ ...x, brand: undefined })) }}
                        options={[{ value: '', label: t('att_term_brand_pick') }, ...brands.map(b => ({ value: b.id, label: b.name }))]} />
                )}</Field>
                <Field label={t('att_term_serial_label')} hint={t('att_term_serial_hint')} error={errors.serialNumber}>{p => (
                    // Typed as printed: left to right in either language.
                    <TextInput {...p} name="serialNumber" autoComplete="off" spellCheck={false} dir="ltr" maxLength={64} value={serialNumber}
                        onChange={e => { setSerialNumber(e.target.value); setErrors(x => ({ ...x, serialNumber: undefined })) }} />
                )}</Field>
                <Field label={t('att_term_mode')} hint={t('att_term_mode_hint')}>{p => (
                    <Select {...p} name="mode" value={mode} options={MODES.map(m => ({ value: m, label: t(MODE_LABEL[m]) }))} onChange={e => setMode(e.target.value as Mode)} />
                )}</Field>
                {brand ? <>
                    <Choice
                        legend={t('att_term_connection')}
                        name="connection"
                        value={connection}
                        onChange={setPicked}
                        options={choices.map(c => ({ value: c.connection, label: t(`att_term_connection_${c.connection}`), disabled: !c.built }))}
                        warning={whyNot || undefined}
                    />
                    {connection && <p className="ui-hint">{t(officeAsked ? 'att_term_connection_DIRECT_ZKTECO_hint' : `att_term_connection_${connection}_hint`)}</p>}
                    {officeAsked && <OfficeField value={office} error={errors.office} onChange={v => { setOffice(v); setErrors(x => ({ ...x, office: undefined })) }} />}
                    {blocked && <p id={noneId} className="ui-hint">{t('att_term_connection_none')}</p>}
                </> : <p className="ui-hint">{t('att_term_connection_pick_brand')}</p>}
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy} aria-disabled={blocked || undefined} aria-describedby={blocked ? noneId : undefined}>{t('att_term_add_device')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

/**
 * What to set on a terminal that sends its scans straight to Nizmo, shown
 * once (DESIGN.md §5.5, Dialog): each setting under the name the terminal
 * gives it, its value left to right and never translated, the two too long
 * to type in a box with Copy. The URL holds the terminal's secret: it isn't
 * kept anywhere on this page, and Done is the end of it.
 *
 * The destination is this Nizmo's own address, as the page was opened on
 * (ATTENDANCE_PLAN.md §18, 6), so it follows Nizmo to another address.
 */
export function TerminalAddressDialog({ name, path, host, brand, onClose }: {
    name: string
    /** The path with the secret in it, as the server returned it once. */
    path: string
    host: string
    /** The terminal's brand, for the Super Admin's notes on it, where it has some. */
    brand: GuideBrand | null
    onClose: () => void
}) {
    const { t } = useLanguage()
    return (
        <Dialog
            open
            onClose={onClose}
            title={t('att_term_address_title').replace('{name}', name)}
            actions={<Button variant="primary" onClick={onClose}>{t('att_term_done')}</Button>}
        >
            <div className="ui-guide">
                {brand && (brand.notesEn || brand.notesAr) && <p className="ui-guide-notes"><ModelNotes brand={brand} /></p>}
                <p><Sentence text={t('att_term_address_intro')} /></p>
                <dl className="ui-device-settings">
                    {hikvisionSettings(host, path).map(setting => (
                        <div key={setting.name}>
                            {/* The terminal's own name for it, to match on its screen: never translated. */}
                            <dt><bdi dir="ltr" lang="en" translate="no">{setting.name}</bdi></dt>
                            <dd>{setting.copy ? <CodeBox code={setting.value} /> : <code className="ui-guide-inline" dir="ltr" translate="no">{setting.value}</code>}</dd>
                        </div>
                    ))}
                </dl>
                <p className="ui-hint">{t('att_term_address_once')}</p>
                <p><Sentence text={t('att_term_address_pictures')} /></p>
                <p>{t('att_term_address_then')}</p>
            </div>
        </Dialog>
    )
}

/**
 * The office's internet address a ZKTeco terminal straight to Nizmo is let
 * in from (ATTENDANCE_PLAN.md §17.3, PR 297): one address or range a line,
 * as a check-in location's office IPs, left to right in either language
 * (DESIGN.md §5.5, Dialog).
 */
function OfficeField({ value, error, onChange }: { value: string; error?: string; onChange: (value: string) => void }) {
    const { t } = useLanguage()
    return (
        <Field label={t('att_term_office')} hint={t('att_term_office_hint')} error={error}>{p => (
            <TextArea {...p} name="officeAddresses" dir="ltr" rows={2} spellCheck={false} autoComplete="off" value={value} onChange={e => onChange(e.target.value)} />
        )}</Field>
    )
}

/**
 * What to set on a ZKTeco terminal straight to Nizmo (ATTENDANCE_PLAN.md
 * §17.7, PR 297; DESIGN.md §5.5, Dialog): each setting under the name its
 * Cloud Server Setting gives it, its value left to right and never
 * translated, the server's address in a box with Copy. Nothing in it is
 * secret, so it's shown after the terminal is added and again from its
 * menu, with no line about being shown once.
 */
export function TerminalSettingsDialog({ name, host, brand, onClose }: {
    name: string
    host: string
    /** The terminal's brand, for the Super Admin's notes on it, where it has some. */
    brand: GuideBrand | null
    onClose: () => void
}) {
    const { t } = useLanguage()
    return (
        <Dialog
            open
            onClose={onClose}
            title={t('att_term_address_title').replace('{name}', name)}
            actions={<Button variant="primary" onClick={onClose}>{t('att_term_done')}</Button>}
        >
            <div className="ui-guide">
                {brand && (brand.notesEn || brand.notesAr) && <p className="ui-guide-notes"><ModelNotes brand={brand} /></p>}
                <p><Sentence text={t('att_term_settings_intro')} /></p>
                <dl className="ui-device-settings">
                    {zktecoSettings(host).map(setting => (
                        <div key={setting.name}>
                            {/* The terminal's own name for it, to match on its screen: never translated. */}
                            <dt><bdi dir="ltr" lang="en" translate="no">{setting.name}</bdi></dt>
                            <dd>{setting.copy ? <CodeBox code={setting.value} /> : <code className="ui-guide-inline" dir="ltr" translate="no">{setting.value}</code>}</dd>
                        </div>
                    ))}
                </dl>
                <p className="ui-hint">{t('att_term_settings_again')}</p>
                <p>{t('att_term_address_then')}</p>
            </div>
        </Dialog>
    )
}

/**
 * The office's internet address changed, for a ZKTeco terminal straight to
 * Nizmo (ATTENDANCE_PLAN.md §17.7, PR 297): the same field, filled with
 * what's kept, and needed. Saving asks for the step-up code, as adding it
 * did; the server says whether each line is an address.
 */
export function OfficeAddressDialog({ name, addresses, busy, onClose, onSubmit }: {
    name: string
    addresses: string[]
    busy: boolean
    onClose: () => void
    onSubmit: (addresses: string[]) => Promise<void>
}) {
    const { t } = useLanguage()
    const formRef = useRef<HTMLFormElement>(null)
    const [office, setOffice] = useState(addresses.join('\n'))
    const [error, setError] = useState<string | undefined>()
    const submit = async (e: FormEvent) => {
        e.preventDefault()
        const typed = addressLines(office)
        if (typed.length === 0) { setError(t('att_term_office_required')); focusFirstWrong(formRef.current); return }
        await onSubmit(typed)
    }
    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t('att_term_change_office_title').replace('{name}', name)}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={submit}>
                <p>{t('att_term_change_office_body')}</p>
                <OfficeField value={office} error={error} onChange={v => { setOffice(v); setError(undefined) }} />
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('save')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

/**
 * A terminal moved to its other way of connecting (ATTENDANCE_PLAN.md
 * §17.6, §17.7, PR 298; DESIGN.md §5.5, Dialog): titled with where it moves
 * to, saying what changes and what stays, its main button saying the move.
 * Straight to Nizmo, a ZKTeco terminal's office's address is asked for and
 * needed, as adding it does, and the server asks for the step-up code. To
 * the agent nothing is asked: it's a confirmation, not in the danger
 * colour, since nothing is lost. What to turn off on the terminal is named
 * as its own screen names it, ZKTeco's or Hikvision's (PR 301).
 */
export function ConnectionDialog({ name, to, protocol, officeAsked, busy, onClose, onSubmit }: {
    name: string
    to: TerminalConnection
    protocol: TerminalProtocol
    /** Whether, moved, it's let in from its office's address alone, which is then asked for. */
    officeAsked: boolean
    busy: boolean
    onClose: () => void
    onSubmit: (officeAddresses?: string[]) => Promise<void>
}) {
    const { t } = useLanguage()
    const formRef = useRef<HTMLFormElement>(null)
    const [office, setOffice] = useState('')
    const [error, setError] = useState<string | undefined>()
    const submit = async (e: FormEvent) => {
        e.preventDefault()
        const typed = addressLines(office)
        if (officeAsked && typed.length === 0) { setError(t('att_term_office_required')); focusFirstWrong(formRef.current); return }
        await onSubmit(officeAsked ? typed : undefined)
    }
    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t(`att_term_move_${to}_title`).replace('{name}', name)}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={submit}>
                <p><Sentence text={t(to === 'AGENT' && protocol === 'HIKVISION' ? 'att_term_move_AGENT_HIKVISION_body' : `att_term_move_${to}_body`)} /></p>
                {officeAsked && <OfficeField value={office} error={error} onChange={v => { setOffice(v); setError(undefined) }} />}
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t(`att_term_move_${to}`)}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
