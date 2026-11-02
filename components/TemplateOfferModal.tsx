'use client'

import { useRef, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { refusalOf } from '@/components/CompanyRolesCard'
import { Button, Dialog, DialogActions } from '@/components/ui'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'
import { countOf } from '@/lib/plural'
import { isPermission, type Scope } from '@/lib/permissions/catalogue'
import { permissionLabelKey, scopeLabelKey } from '@/lib/permissions/matrix'
import type { TranslationKey } from '@/lib/translations'

/**
 * "Offer this change to companies using this template" (ROLES_PLAN.md §6.8):
 * the company roles copied from a template, what applying it would change in
 * each, and only the ones picked are changed.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, the Super Admin's pages part
 * 1): the building blocks' dialog, named for the template, a box for each
 * role, and Apply with nothing picked said under the list, where the button
 * was off without a word.
 */
type Difference = { added: string[]; removed: string[]; rescoped: { permission: string; from: string; to: string }[] }
type Offer = { id: string; name: string; companyName: string; holders: number; difference: Difference }

/** What's wrong on Apply, said under the list; null when a role is picked. */
export function pickError(picked: string[]): TranslationKey | null {
    return picked.length ? null : 'template_offer_pick_required'
}

export default function TemplateOfferModal({ template, onClose }: { template: { id: string; name: string } | null; onClose: () => void }) {
    if (!template) return null
    // Mounted afresh each time it opens, so it starts with nothing picked.
    return <OfferDialog template={template} onClose={onClose} />
}

function OfferDialog({ template, onClose }: { template: { id: string; name: string }; onClose: () => void }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const formRef = useRef<HTMLFormElement>(null)
    const [picked, setPicked] = useState<string[]>([])
    const [wrong, setWrong] = useState<TranslationKey | null>(null)
    const [applyNow, setApplyNow] = useState(false)
    const [applying, setApplying] = useState(false)
    const { data, error, isValidating, mutate } = useSWR(`/api/role-templates/push?id=${template.id}`, fetcher)
    const roles: Offer[] | null = data ? data.data?.roles ?? [] : null

    const label = (p: string) => isPermission(p) ? t(permissionLabelKey(p)) : p
    const scope = (s: string) => t(scopeLabelKey(s as Scope))
    const list = (items: string[]) => items.join(t('list_separator'))
    const differs = (d: Difference) => d.added.length + d.removed.length + d.rescoped.length > 0
    /** What applying the template changes in a role, a line each. */
    const changes = (d: Difference) => [
        ...(d.added.length ? [t('template_offer_added').replace('{list}', list(d.added.map(label)))] : []),
        ...(d.removed.length ? [t('template_offer_removed').replace('{list}', list(d.removed.map(label)))] : []),
        ...(d.rescoped.length ? [t('template_offer_rescoped').replace('{list}', list(d.rescoped.map(c => t('template_offer_rescoped_one')
            .replace('{permission}', label(c.permission)).replace('{from}', scope(c.from)).replace('{to}', scope(c.to)))))] : []),
    ]

    const apply = async (e: FormEvent) => {
        e.preventDefault()
        const found = pickError(picked)
        setWrong(found)
        if (found) { focusFirstWrong(formRef.current); return }
        setApplying(true)
        try {
            const res = await fetch('/api/role-templates/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templateId: template.id, roleIds: picked, applyNow }),
            })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            showToast(t('template_offer_applied'), 'success')
            setPicked([])
            await mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setApplying(false)
        }
    }

    const firstOpen = roles?.find(r => differs(r.difference))?.id

    return (
        <Dialog open onClose={() => { if (!applying) onClose() }} title={t('template_offer_title_named').replace('{name}', template.name)}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={apply}>
                <p>{t('template_offer_hint')}</p>

                {!roles ? (
                    error ? (
                        <p>{t('template_offer_load_failed')}{' '}<Button size="sm" busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button></p>
                    ) : (
                        <p className="ui-hint" role="status">{t('loading')}</p>
                    )
                ) : roles.length === 0 ? (
                    <p>{t('template_offer_none')}</p>
                ) : (
                    <div className="ui-field">
                        <fieldset className="ui-choices" aria-describedby={wrong ? `${template.id}-pick` : undefined}>
                            <legend className="ui-label">{t('template_offer_legend')}</legend>
                            {roles.map(r => {
                                const same = !differs(r.difference)
                                return (
                                    <label key={r.id} className="ui-choice ui-choice-top">
                                        {/* One already the same has nothing to apply. */}
                                        <input type="checkbox" className="ui-check" name="role" value={r.id} disabled={same || applying}
                                            aria-invalid={wrong && r.id === firstOpen ? true : undefined}
                                            checked={picked.includes(r.id)}
                                            onChange={e => { setPicked(e.target.checked ? [...picked, r.id] : picked.filter(id => id !== r.id)); setWrong(null) }} />
                                        <span className="ui-choice-text">
                                            <span><bdi>{r.companyName}</bdi>{t('list_separator')}<bdi>{r.name}</bdi>{t('list_separator')}{countOf(t, locale, r.holders, 'employees')}</span>
                                            {same
                                                ? <span className="ui-hint">{t('template_offer_same')}</span>
                                                : changes(r.difference).map((line, i) => <span key={i} className="ui-hint">{line}</span>)}
                                        </span>
                                    </label>
                                )
                            })}
                        </fieldset>
                        {wrong && <span id={`${template.id}-pick`} className="ui-error">{t(wrong)}</span>}
                    </div>
                )}

                <label className="ui-choice">
                    <input type="checkbox" className="ui-check" name="applyNow" checked={applyNow} onChange={e => setApplyNow(e.target.checked)} />
                    {t('roles_apply_now')}
                </label>

                <DialogActions>
                    <Button onClick={onClose} disabled={applying}>{t('cancel')}</Button>
                    {/* Nothing to apply to while there's no role: only Cancel. */}
                    {roles && roles.length > 0 && <Button type="submit" variant="primary" busy={applying}>{t('template_offer_apply')}</Button>}
                </DialogActions>
            </form>
        </Dialog>
    )
}
