'use client'

import { useRef, useState, type FormEvent } from 'react'
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

/**
 * Adding a company and changing one, and asking before a ban (the Super
 * Admin's pages part 3a, UI_PLAN.md §5 step 5): the building blocks' dialog,
 * each field labelled, what's wrong said under its field. Each stays open,
 * its button busy, until the server has answered.
 */

export type ListedCompany = { id: string; name: string; isBanned?: boolean; package?: { id: string; name: string } | null }

/** What's wrong with a company's name on Save; null when it'll do. The server wants 2 to 50 characters. */
export function companyNameError(name: string): TranslationKey | null {
    return name.trim().length < 2 ? 'companies_name_short' : null
}

/**
 * A company's name and package, and, when it's new, how long its trial is.
 * The trial is chosen once: changing it later would move an end date
 * somebody has already been told, and extending one is an action of its own.
 */
export function CompanyDialog({ company, onClose, onSaved }: {
    company: ListedCompany | null
    onClose: () => void
    onSaved: (name: string, added: boolean) => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { data } = useSWR('/api/packages', fetcher)
    const packages: { id: string; name: string }[] = data?.data ?? []
    const formRef = useRef<HTMLFormElement>(null)
    const [name, setName] = useState(company?.name ?? '')
    const [trial, setTrial] = useState<TrialPreset>(DEFAULT_TRIAL_PRESET)
    const [packageId, setPackageId] = useState(company?.package?.id ?? '')
    const [wrong, setWrong] = useState<TranslationKey | null>(null)
    const [busy, setBusy] = useState(false)

    // "14 days" is abstract; a date can be checked. Worked out with the
    // server's own helper: a preview worked out another way is one that can
    // be wrong, and this is where a clamped month (31 January + 1 month) is
    // noticed by the Super Admin rather than by the customer.
    const ends = computeTrialEnd(new Date(), trial, 0)?.toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

    const save = async (e: FormEvent) => {
        e.preventDefault()
        const found = companyNameError(name)
        setWrong(found)
        if (found) { focusFirstWrong(formRef.current); return }
        setBusy(true)
        try {
            const trimmed = name.trim()
            const res = await fetch('/api/companies', {
                method: company ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(company ? { id: company.id, name: trimmed } : { name: trimmed, trialPreset: trial, packageId: packageId || null }),
            })
            if (!res.ok) {
                const body = await res.clone().json().catch(() => ({}))
                // Adding says "Company already exists", renaming "Company name already exists".
                if (typeof body?.error === 'string' && body.error.endsWith('already exists')) {
                    setWrong('companies_name_taken')
                    focusFirstWrong(formRef.current)
                } else {
                    showToast(await refusalOf(res, t('error_generic')), 'error')
                }
                return
            }
            // A package changed on an existing company is its own call. Its
            // refusal is said, where it was dropped without a word.
            if (company && packageId !== (company.package?.id ?? '')) {
                const moved = await fetch(`/api/companies/${company.id}/package`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ packageId: packageId || null }),
                })
                if (!moved.ok) {
                    showToast(`${t('companies_package_failed')} ${await refusalOf(moved, t('error_generic'))}`, 'error')
                    return
                }
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
