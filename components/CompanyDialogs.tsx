'use client'

import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { refusalOf } from '@/components/CompanyRolesCard'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { Button, Dialog, DialogActions, Field, Select, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { computeTrialEnd, DEFAULT_TRIAL_PRESET, TRIAL_PRESETS, type TrialPreset } from '@/lib/billing/state'
import { TRIAL_PRESET_LABEL_KEY } from '@/lib/subscription-display'
import { fetcher } from '@/lib/swr-fetcher'
import type { TranslationKey } from '@/lib/translations'
import { codeError, normaliseCode } from '@/lib/username-code'

/**
 * Adding a company and changing one, and asking before a ban (the Super
 * Admin's pages part 3a, UI_PLAN.md §5 step 5): the building blocks' dialog,
 * each field labelled, what's wrong said under its field. Each stays open,
 * its button busy, until the server has answered.
 */

export type ListedCompany = {
    id: string
    name: string
    isBanned?: boolean
    package?: { id: string; name: string } | null
    /** The letters before the number in its people's usernames, and whether they're fixed: its first username has been given. */
    usernameCode?: string | null
    usernameLocked?: boolean
}

/** What's wrong with a company's name on Save; null when it'll do. The server wants 2 to 50 characters. */
export function companyNameError(name: string): TranslationKey | null {
    return name.trim().length < 2 ? 'companies_name_short' : null
}

/** Where to ask for a username code for a name, once it's long enough to have one; the company being edited is named, since its own code is free for it. */
export function suggestionUrl(name: string, companyId: string | null): string | null {
    const trimmed = name.trim()
    if (companyNameError(trimmed)) return null
    const query = new URLSearchParams({ name: trimmed })
    if (companyId) query.set('id', companyId)
    return `/api/companies/username-code?${query}`
}

/** The field a refusal from the server is about, and what to say under it; null for one said in a toast. */
export function refusedField(error: unknown): { field: 'name' | 'usernameCode'; key: TranslationKey } | null {
    if (typeof error !== 'string') return null
    // Adding says "Company already exists", renaming "Company name already exists".
    if (error.endsWith('already exists')) return { field: 'name', key: 'companies_name_taken' }
    if (error === 'Username code taken') return { field: 'usernameCode', key: 'companies_code_taken' }
    // Its first username was given while the dialog was open.
    if (error === 'Username code fixed') return { field: 'usernameCode', key: 'companies_code_locked' }
    return null
}

/**
 * Saving a company: its name (and, when it's new, its trial and package), then
 * a package changed on an existing one, which is its own call. Says which
 * step failed, with the server's answer: a package refused after the name
 * saved leaves the name saved (Codex on PR 171).
 */
export async function saveCompany(company: ListedCompany | null, fields: { name: string; trial: TrialPreset; packageId: string; usernameCode: string }): Promise<
    { step: 'saved' } | { step: 'name' | 'package'; res: Response }
> {
    const json = { 'Content-Type': 'application/json' }
    // A new company without one gets one suggested by the server. An edit
    // sends one only when it's changed, and never once it's fixed.
    const code = normaliseCode(fields.usernameCode) || undefined
    const changedCode = company && !company.usernameLocked && code !== (company.usernameCode ?? undefined) ? code : undefined
    const res = await fetch('/api/companies', {
        method: company ? 'PUT' : 'POST',
        headers: json,
        body: JSON.stringify(company
            ? { id: company.id, name: fields.name, usernameCode: changedCode }
            : { name: fields.name, trialPreset: fields.trial, packageId: fields.packageId || null, usernameCode: code }),
    })
    if (!res.ok) return { step: 'name', res }
    if (company && fields.packageId !== (company.package?.id ?? '')) {
        const moved = await fetch(`/api/companies/${company.id}/package`, { method: 'PUT', headers: json, body: JSON.stringify({ packageId: fields.packageId || null }) })
        if (!moved.ok) return { step: 'package', res: moved }
    }
    return { step: 'saved' }
}

/**
 * A company's name, username code and package, and, when it's new, how long
 * its trial is. The trial is chosen once: changing it later would move an end
 * date somebody has already been told, and extending one is an action of its
 * own. The code follows the name, suggested by the server so it's one no
 * other company has, until it's typed; it's fixed once the company's first
 * username has been given.
 */
export function CompanyDialog({ company, onClose, onSaved, onChanged }: {
    company: ListedCompany | null
    onClose: () => void
    onSaved: (name: string, added: boolean) => void
    /** The name saved but the package didn't: the list shows the new name, and the dialog stays for another try. */
    onChanged: () => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { data } = useSWR('/api/packages', fetcher)
    const packages: { id: string; name: string }[] = data?.data ?? []
    const formRef = useRef<HTMLFormElement>(null)
    const [name, setName] = useState(company?.name ?? '')
    const [trial, setTrial] = useState<TrialPreset>(DEFAULT_TRIAL_PRESET)
    const [packageId, setPackageId] = useState(company?.package?.id ?? '')
    const locked = !!company?.usernameLocked
    const [code, setCode] = useState(company?.usernameCode ?? '')
    const [codeTyped, setCodeTyped] = useState(!!company?.usernameCode)
    const [wrong, setWrong] = useState<TranslationKey | null>(null)
    const [codeWrong, setCodeWrong] = useState<TranslationKey | null>(null)
    const [busy, setBusy] = useState(false)

    // Asked a moment after the name stops changing, not at each letter.
    const [askFor, setAskFor] = useState<string | null>(null)
    useEffect(() => {
        if (codeTyped) return
        const wait = setTimeout(() => setAskFor(suggestionUrl(name, company?.id ?? null)), 300)
        return () => clearTimeout(wait)
    }, [name, codeTyped, company?.id])
    const { data: suggested } = useSWR(codeTyped ? null : askFor, fetcher, { keepPreviousData: true })
    const shownCode = codeTyped ? code : (suggested?.data?.code ?? code)
    const example = /^[a-z]+$/.test(shownCode) ? `${shownCode}0, ${shownCode}1…` : null
    // The example is English letters, kept left to right inside an Arabic sentence.
    const withExample = (key: TranslationKey) => t(key).split('{example}').map((part, i) => <Fragment key={i}>{i > 0 && <bdi dir="ltr">{example}</bdi>}{part}</Fragment>)
    const codeHint = locked && example ? withExample('companies_code_fixed')
        : example && !codeError(shownCode) ? withExample('companies_code_hint')
            : t('companies_code_rule')

    // "14 days" is abstract; a date can be checked. Worked out with the
    // server's own helper: a preview worked out another way is one that can
    // be wrong, and this is where a clamped month (31 January + 1 month) is
    // noticed by the Super Admin rather than by the customer.
    const ends = computeTrialEnd(new Date(), trial, 0)?.toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

    const save = async (e: FormEvent) => {
        e.preventDefault()
        const found = companyNameError(name)
        // An empty code nobody typed is the server's to suggest.
        const foundInCode = locked || (!shownCode && !codeTyped) ? null : codeError(shownCode)
        setWrong(found)
        setCodeWrong(foundInCode)
        if (found || foundInCode) { focusFirstWrong(formRef.current); return }
        setBusy(true)
        try {
            const trimmed = name.trim()
            const result = await saveCompany(company, { name: trimmed, trial, packageId, usernameCode: shownCode })
            // The package's refusal is said, where it was dropped without a
            // word, and the list shows the name that did save (Codex on PR 171).
            if (result.step === 'package') {
                onChanged()
                showToast(`${t('companies_package_failed')} ${await refusalOf(result.res, t('error_generic'))}`, 'error')
                return
            }
            if (result.step === 'name') {
                const body = await result.res.clone().json().catch(() => ({}))
                const refused = refusedField(body?.error)
                if (refused) {
                    if (refused.field === 'name') setWrong(refused.key)
                    else setCodeWrong(refused.key)
                    focusFirstWrong(formRef.current)
                } else {
                    showToast(await refusalOf(result.res, t('error_generic')), 'error')
                }
                return
            }
            onSaved(trimmed, !company)
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={company ? t('companies_edit_title').replace('{name}', company.name) : t('companies_add')}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={save}>
                <Field label={t('companies_name_label')} error={wrong && t(wrong)}>{p => (
                    <TextInput {...p} name="name" autoComplete="off" maxLength={50} value={name} onChange={e => { setName(e.target.value); setWrong(null) }} />
                )}</Field>
                {/* English letters whatever the page's language, so written left to right. */}
                <Field label={t('companies_code_label')} hint={codeHint} error={codeWrong && t(codeWrong)}>{p => (
                    <TextInput {...p} name="usernameCode" dir="ltr" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={8}
                        readOnly={locked} value={shownCode} onChange={e => { setCode(e.target.value); setCodeTyped(true); setCodeWrong(null) }} />
                )}</Field>
                {!company && (
                    <Field label={t('trial_length')} hint={ends && t('companies_trial_ends').replace('{date}', ends)}>{p => (
                        <Select {...p} name="trialPreset" value={trial} onChange={e => setTrial(e.target.value as TrialPreset)}
                            options={TRIAL_PRESETS.map(preset => ({ value: preset, label: t(TRIAL_PRESET_LABEL_KEY[preset]) }))} />
                    )}</Field>
                )}
                {/* No package is a choice with consequences, every module on and
                    nothing gated, so it's named as one rather than left blank. */}
                <Field label={t('package_label')}>{p => (
                    <Select {...p} name="packageId" value={packageId} onChange={e => setPackageId(e.target.value)}
                        options={[{ value: '', label: t('no_package') }, ...packages.map(pkg => ({ value: pkg.id, label: pkg.name }))]} />
                )}</Field>
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{company ? t('save') : t('companies_add_submit')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

/**
 * Banning a company, or lifting its ban: what it does to its people, asked
 * first. A ban is in the danger colour; lifting one isn't.
 */
export function BanCompanyDialog({ company, busy, onCancel, onConfirm }: {
    company: ListedCompany
    busy: boolean
    onCancel: () => void
    onConfirm: () => void
}) {
    const { t } = useLanguage()
    const banning = !company.isBanned
    return (
        <Dialog
            open
            onClose={() => { if (!busy) onCancel() }}
            title={t(banning ? 'companies_ban_title' : 'companies_unban_title').replace('{name}', company.name)}
            actions={<>
                <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
                <Button variant={banning ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>{t(banning ? 'companies_ban' : 'companies_unban')}</Button>
            </>}
        >
            <p>{t(banning ? 'companies_ban_body' : 'companies_unban_body')}</p>
        </Dialog>
    )
}
