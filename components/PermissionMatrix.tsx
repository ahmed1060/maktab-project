'use client'

import { useId, useState } from 'react'
import { CaretDownIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { Icon, Select, StatusBadge } from '@/components/ui'
import { PERMISSIONS, type Permission, type Scope } from '@/lib/permissions/catalogue'
import type { Grants } from '@/lib/permissions/grants'
import { hasModule, deserializeAccess, type SerializedAccess } from '@/lib/features/bundles'
import {
    PERMISSION_GROUPS, permissionLabelKey, groupLabelKey, scopeLabelKey, riskLabelKey,
    setGrant, neededBy, drift, widestScope,
} from '@/lib/permissions/matrix'

/**
 * The permission matrix (ROLES_PLAN.md §6.3): one row per permission, grouped
 * and collapsible, a checkbox and — where a permission may be granted at more
 * than one scope — a scope selector.
 *
 * Ticking a row adds what it needs, as the server will (lib/permissions/
 * matrix.ts), so what is shown is what gets saved. Rows in a module outside the
 * company's package are greyed, not hidden: the grant is kept and starts
 * working if the package changes. With `template`, rows that differ from it are
 * marked — a company's role drifting from what it was copied from.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 4c):
 * each group a row that opens, as a person's pay on Payroll does, and what a
 * row's greying or marking means said under it, where it was only a tooltip.
 */
type Props = {
    grants: Grants
    onChange: (next: Grants) => void
    disabled?: boolean
    /** The company's package; omitted for a template, which belongs to no company. */
    access?: SerializedAccess | null
    template?: Grants | null
}

export default function PermissionMatrix({ grants, onChange, disabled = false, access, template }: Props) {
    const { t, locale } = useLanguage()
    const id = useId()
    const [open, setOpen] = useState<Record<string, boolean>>({})
    const [compare, setCompare] = useState(false)

    const features = access ? deserializeAccess(access) : null
    const needed = neededBy(grants)
    const drifted = compare && template ? drift(grants, template) : new Set<Permission>()
    const label = (p: Permission) => t(permissionLabelKey(p))
    const number = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')

    return (
        <section className="ui-perm-matrix" aria-labelledby={`${id}-title`}>
            <div className="ui-perm-head">
                <h3 className="ui-subsection-title" id={`${id}-title`}>{t('roles_permissions')}</h3>
                <span className="ui-hint">{t('roles_selected').replace('{count}', number(Object.keys(grants).length))}</span>
            </div>
            {template && (
                <label className="ui-choice">
                    <input type="checkbox" className="ui-check" name="compare" checked={compare} onChange={e => setCompare(e.target.checked)} />
                    {t('roles_compare_template')}
                </label>
            )}

            <ul className="ui-rows ui-rows-flush ui-perm-groups">
                {PERMISSION_GROUPS.map(group => {
                    const held = group.permissions.filter(p => grants[p]).length
                    const isOpen = open[group.key] ?? held > 0
                    const listId = `${id}-${group.key}`
                    const name = t(groupLabelKey(group.key))
                    return (
                        <li key={group.key}>
                            <div className="ui-row">
                                <button type="button" className="ui-row-main ui-row-toggle" aria-expanded={isOpen} aria-controls={listId}
                                    onClick={() => setOpen({ ...open, [group.key]: !isOpen })}>
                                    <span className="ui-item-title">{name}<Icon icon={CaretDownIcon} size={16} className="ui-row-caret" /></span>
                                    <span className="ui-item-detail">{t('roles_group_held').replace('{held}', number(held)).replace('{total}', number(group.permissions.length))}</span>
                                </button>
                            </div>
                            {/* There while closed, hidden, so the button always names what it opens. */}
                            <ul id={listId} className="ui-perm-rows" aria-label={name} hidden={!isOpen}>
                                {group.permissions.map(p => {
                                    const def = PERMISSIONS[p]
                                    const scope = grants[p]
                                    const scopes = def.scopes as readonly Scope[]
                                    const outside = !!features && def.module !== null && !hasModule(features, def.module)
                                    const requiredBy = scope ? needed[p] : undefined
                                    const risk = riskLabelKey(p)
                                    const differs = drifted.has(p)
                                    // Why it's greyed or marked, tied to its box so a screen
                                    // reader says it too (audit on part 4c).
                                    const notes = [
                                        ...(requiredBy?.length ? [t('roles_needed_by').replace('{name}', requiredBy.map(label).join(t('list_separator')))] : []),
                                        ...(outside ? [t('roles_not_in_package')] : []),
                                        ...(differs ? [t('roles_differs')] : []),
                                    ]
                                    const noteId = (i: number) => `${listId}-${p}-${i}`
                                    return (
                                        <li key={p} data-outside={outside || undefined} data-drift={differs || undefined}>
                                            <span className="ui-perm-main">
                                                <label className="ui-choice">
                                                    <input type="checkbox" className="ui-check" name={`perm-${p}`}
                                                        aria-describedby={notes.length ? notes.map((_, i) => noteId(i)).join(' ') : undefined}
                                                        checked={!!scope}
                                                        // A row another ticked row needs would only come back.
                                                        disabled={disabled || !!requiredBy?.length}
                                                        onChange={e => onChange(setGrant(grants, p, e.target.checked ? widestScope(p) : null))} />
                                                    {label(p)}
                                                </label>
                                                {risk && <StatusBadge tone="problem">{t(risk)}</StatusBadge>}
                                                {notes.map((note, i) => <span key={i} id={noteId(i)} className="ui-hint ui-choice-hint">{note}</span>)}
                                            </span>
                                            {scopes.length > 1 ? (
                                                <Select
                                                    name={`scope-${p}`}
                                                    aria-label={`${t('who_can_scope')}: ${label(p)}`}
                                                    value={scope ?? ''}
                                                    disabled={disabled || !scope}
                                                    onChange={e => onChange(setGrant(grants, p, e.target.value as Scope))}
                                                    options={[...(scope ? [] : [{ value: '', label: '—' }]), ...scopes.map(s => ({ value: s, label: t(scopeLabelKey(s)) }))]}
                                                />
                                            ) : (
                                                <span className="ui-perm-scope">{t(scopeLabelKey(scopes[0]))}</span>
                                            )}
                                        </li>
                                    )
                                })}
                            </ul>
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}
