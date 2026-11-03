'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { refusalOf } from '@/components/CompanyRolesCard'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { Button, Dialog, DialogActions, Field, TextArea, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { countOf } from '@/lib/plural'
import { amountError, typedAmount } from '@/lib/subscription-display'
import type { TranslationKey } from '@/lib/translations'

/**
 * Adding a package and changing one (the Super Admin's pages part 3b,
 * UI_PLAN.md §5 step 5): its name, what it costs, what it grants and whether
 * it's sold, each field labelled and what's wrong said under it. A change
 * reaches every company on the package at once, so it says how many before
 * Save, and what turning HR off takes with it.
 */

export type ListedPackage = {
    id: string
    name: string
    description: string | null
    isActive: boolean
    isPublic: boolean
    priceMonthly: number
    priceAnnual: number
    priceLifetime: number | null
    hasCompanyManagement: boolean
    hasHR: boolean
    hasAttendanceTerminals: boolean
    hasAttendanceMobile: boolean
    _count?: { companies: number }
}

type Bundle = 'hasCompanyManagement' | 'hasHR' | 'hasAttendanceTerminals' | 'hasAttendanceMobile'
export type PackageForm = {
    name: string
    description: string
    priceMonthly: string
    priceAnnual: string
    /** Empty is meaningful: not sold for life, which isn't the same as sold for nothing. */
    priceLifetime: string
    isActive: boolean
    isPublic: boolean
} & Record<Bundle, boolean>
type Price = 'priceMonthly' | 'priceAnnual' | 'priceLifetime'
export type PackageErrors = Partial<Record<'name' | Price, TranslationKey>>

export function emptyPackage(): PackageForm {
    return {
        name: '', description: '', priceMonthly: '', priceAnnual: '', priceLifetime: '', isActive: true, isPublic: true,
        hasCompanyManagement: false, hasHR: false, hasAttendanceTerminals: false, hasAttendanceMobile: false,
    }
}

export function formOf(pkg: ListedPackage): PackageForm {
    return {
        name: pkg.name,
        description: pkg.description ?? '',
        priceMonthly: String(pkg.priceMonthly),
        priceAnnual: String(pkg.priceAnnual),
        priceLifetime: pkg.priceLifetime === null ? '' : String(pkg.priceLifetime),
        isActive: pkg.isActive,
        isPublic: pkg.isPublic,
        hasCompanyManagement: pkg.hasCompanyManagement,
        hasHR: pkg.hasHR,
        hasAttendanceTerminals: pkg.hasAttendanceTerminals,
        hasAttendanceMobile: pkg.hasAttendanceMobile,
    }
}

/** A bundle switched. The attendance add-ons sit on HR, so HR going off takes them with it, as the server does. */
export function withBundle(form: PackageForm, bundle: Bundle, on: boolean): PackageForm {
    return { ...form, [bundle]: on, ...(bundle === 'hasHR' && !on ? { hasAttendanceTerminals: false, hasAttendanceMobile: false } : {}) }
}

/** Whether saving takes the attendance add-ons from the companies on a package, with its HR. */
export function losesAttendance(pkg: ListedPackage | null, form: PackageForm): boolean {
    return !!pkg && !form.hasHR && (pkg.hasAttendanceTerminals || pkg.hasAttendanceMobile)
}

const PRICE_ERROR: Record<'missing' | 'wrong' | 'places', TranslationKey> = {
    missing: 'packages_price_required',
    wrong: 'packages_price_wrong',
    places: 'amount_two_places',
}

/** What's wrong with each field on Save, as the server would refuse it; empty when it'll do. */
export function packageErrors(form: PackageForm): PackageErrors {
    const errors: PackageErrors = {}
    if (!form.name.trim()) errors.name = 'packages_name_required'
    for (const price of ['priceMonthly', 'priceAnnual', 'priceLifetime'] as const) {
        // A lifetime price can be left empty: it isn't sold for life.
        if (price === 'priceLifetime' && !form.priceLifetime.trim()) continue
        const found = amountError(form[price], { zero: true })
        if (found) errors[price] = PRICE_ERROR[found]
    }
    return errors
}

/** What's sent: the name and description trimmed, the prices as numbers, an empty lifetime price as not sold for life. */
export function packagePayload(form: PackageForm, pkg: ListedPackage | null) {
    return {
        ...(pkg ? { id: pkg.id } : {}),
        name: form.name.trim(),
        description: form.description.trim(),
        isActive: form.isActive,
        isPublic: form.isPublic,
        priceMonthly: typedAmount(form.priceMonthly),
        priceAnnual: typedAmount(form.priceAnnual),
        priceLifetime: form.priceLifetime.trim() === '' ? null : typedAmount(form.priceLifetime),
        hasCompanyManagement: form.hasCompanyManagement,
        hasHR: form.hasHR,
        hasAttendanceTerminals: form.hasAttendanceTerminals,
        hasAttendanceMobile: form.hasAttendanceMobile,
    }
}

export function PackageDialog({ pkg, onClose, onSaved }: {
    pkg: ListedPackage | null
    onClose: () => void
    onSaved: (name: string, added: boolean) => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const id = useId()
    const formRef = useRef<HTMLFormElement>(null)
    const [form, setForm] = useState<PackageForm>(() => pkg ? formOf(pkg) : emptyPackage())
    const [errors, setErrors] = useState<PackageErrors>({})
    const [busy, setBusy] = useState(false)
    const companies = pkg?._count?.companies ?? 0

    const set = (change: Partial<PackageForm>, field?: keyof PackageErrors) => {
        setForm(f => ({ ...f, ...change }))
        if (field) setErrors(e => ({ ...e, [field]: undefined }))
    }
    const error = (field: keyof PackageErrors) => errors[field] && t(errors[field])

    const save = async (e: FormEvent) => {
        e.preventDefault()
        const found = packageErrors(form)
        setErrors(found)
        if (Object.keys(found).length) { focusFirstWrong(formRef.current); return }
        setBusy(true)
        try {
            const res = await fetch('/api/packages', {
                method: pkg ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(packagePayload(form, pkg)),
            })
            if (!res.ok) {
                const body = await res.clone().json().catch(() => ({}))
                if (body?.error === 'A package with this name already exists') {
                    setErrors({ name: 'packages_name_taken' })
                    focusFirstWrong(formRef.current)
                } else {
                    showToast(await refusalOf(res, t('error_generic')), 'error')
                }
                return
            }
            onSaved(form.name.trim(), !pkg)
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }

    const price = (field: Price, label: TranslationKey, hint?: TranslationKey) => (
        <Field label={t(label)} hint={hint && t(hint)} error={error(field)}>{p => (
            <TextInput {...p} inputMode="decimal" autoComplete="off" name={field} value={form[field]} onChange={e => set({ [field]: e.target.value }, field)} />
        )}</Field>
    )
    const box = (field: Bundle | 'isActive' | 'isPublic', label: TranslationKey, needsHR = false) => (
        <label className="ui-choice" data-disabled={(needsHR && !form.hasHR) || undefined}>
            <input type="checkbox" className="ui-check" disabled={needsHR && !form.hasHR} aria-describedby={needsHR ? `${id}-needs-hr` : undefined}
                name={field} checked={form[field]}
                onChange={e => setForm(f => field === 'isActive' || field === 'isPublic' ? { ...f, [field]: e.target.checked } : withBundle(f, field, e.target.checked))} />
            {t(label)}
        </label>
    )

    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={pkg ? t('packages_edit_title').replace('{name}', pkg.name) : t('packages_add')}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={save}>
                {/* Said before Save, not after: a change reaches every company
                    on the package at once, which is the difference between
                    repackaging on purpose and taking a module from live customers mid-day. */}
                {companies > 0 && (
                    <div className="ui-dialog-note" data-tone="waiting"><p>{t('packages_reaches').replace('{count}', countOf(t, locale, companies, 'companies'))}</p></div>
                )}
                <Field label={t('package_name')} error={error('name')}>{p => (
                    <TextInput {...p} name="name" autoComplete="off" maxLength={80} value={form.name} onChange={e => set({ name: e.target.value }, 'name')} />
                )}</Field>
                <Field label={t('package_description')}>{p => (
                    <TextArea {...p} name="description" rows={2} maxLength={500} value={form.description} onChange={e => set({ description: e.target.value })} />
                )}</Field>
                {price('priceMonthly', 'price_monthly')}
                {price('priceAnnual', 'price_annual')}
                {price('priceLifetime', 'price_lifetime', 'packages_lifetime_hint')}
                {/* A group of choices, spaced as the building blocks' radio
                    buttons are, where they were a field's gap apart (found in the browser). */}
                <fieldset className="ui-choices">
                    <legend className="ui-label">{t('packages_grants_legend')}</legend>
                    {box('hasCompanyManagement', 'bundle_company_management')}
                    {box('hasHR', 'bundle_hr')}
                    {box('hasAttendanceTerminals', 'bundle_attendance_terminals', true)}
                    {box('hasAttendanceMobile', 'bundle_attendance_mobile', true)}
                    <p id={`${id}-needs-hr`} className="ui-hint">{t('attendance_requires_hr')}</p>
                    {!form.hasCompanyManagement && !form.hasHR && <p className="ui-hint">{t('packages_core_only_hint')}</p>}
                    {losesAttendance(pkg, form) && (
                        <div className="ui-dialog-note" data-tone="waiting" role="status"><p>{t('attendance_removed_with_hr')}</p></div>
                    )}
                </fieldset>
                <fieldset className="ui-choices">
                    <legend className="ui-label">{t('packages_selling_legend')}</legend>
                    {box('isActive', 'packages_active')}
                    <p className="ui-hint ui-choice-hint">{t('packages_active_hint')}</p>
                    {box('isPublic', 'packages_public')}
                </fieldset>
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{pkg ? t('save') : t('packages_add_submit')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
