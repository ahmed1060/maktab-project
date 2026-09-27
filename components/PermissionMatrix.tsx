'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
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
    const isRtl = locale === 'ar'
    const [open, setOpen] = useState<Record<string, boolean>>({})
    const [compare, setCompare] = useState(false)

    const features = access ? deserializeAccess(access) : null
    const needed = neededBy(grants)
    const drifted = compare && template ? drift(grants, template) : new Set<Permission>()
    const label = (p: Permission) => t(permissionLabelKey(p))

    return (
        <div style={{ textAlign: isRtl ? 'right' : 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <strong>{t('roles_permissions')}</strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-soft)' }}>
                    {t('roles_selected').replace('{count}', String(Object.keys(grants).length))}
                </span>
                {template && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                        <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />
                        {t('roles_compare_template')}
                    </label>
                )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {PERMISSION_GROUPS.map(group => {
                    const held = group.permissions.filter(p => grants[p]).length
                    const isOpen = open[group.key] ?? held > 0
                    return (
                        <div key={group.key} style={{ border: '1px solid var(--veil-40)', borderRadius: '0.75rem', overflow: 'hidden' }}>
                            <button
                                type="button"
                                onClick={() => setOpen({ ...open, [group.key]: !isOpen })}
                                aria-expanded={isOpen}
                                style={{
                                    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '0.6rem 0.9rem', background: 'var(--panel-70)', border: 'none', cursor: 'pointer',
                                    color: 'inherit', font: 'inherit', flexDirection: isRtl ? 'row-reverse' : 'row',
                                }}
                            >
                                <span style={{ fontWeight: 600 }}>{t(groupLabelKey(group.key))}</span>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-soft)' }}>
                                    {held}/{group.permissions.length} {isOpen ? '▾' : '▸'}
                                </span>
                            </button>
                            {isOpen && (
                                <div>
                                    {group.permissions.map(p => {
                                        const def = PERMISSIONS[p]
                                        const scope = grants[p]
                                        const scopes = def.scopes as readonly Scope[]
                                        const outside = !!features && def.module !== null && !hasModule(features, def.module)
                                        const requiredBy = scope ? needed[p] : undefined
                                        const risk = riskLabelKey(p)
                                        return (
                                            <div
                                                key={p}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.9rem',
                                                    borderTop: '1px solid var(--veil-40)', flexDirection: isRtl ? 'row-reverse' : 'row',
                                                    opacity: outside ? 0.5 : 1,
                                                    background: drifted.has(p) ? 'var(--warn-bg-yellow-subtle)' : undefined,
                                                }}
                                                title={outside ? t('roles_not_in_package') : drifted.has(p) ? t('roles_differs') : undefined}
                                            >
                                                <input
                                                    type="checkbox"
                                                    id={`perm-${p}`}
                                                    checked={!!scope}
                                                    // A row another ticked row needs would only come back.
                                                    disabled={disabled || !!requiredBy?.length}
                                                    onChange={e => onChange(setGrant(grants, p, e.target.checked ? widestScope(p) : null))}
                                                    style={{ width: '1rem', height: '1rem', flexShrink: 0 }}
                                                />
                                                <label htmlFor={`perm-${p}`} style={{ flex: 1, cursor: disabled ? 'default' : 'pointer' }}>
                                                    <div>
                                                        {label(p)}
                                                        {risk && (
                                                            <span style={{ marginInlineStart: '0.5rem', fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '999px', background: 'var(--danger-bg-subtle)', color: 'var(--danger-fg)' }}>
                                                                {t(risk)}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {!!requiredBy?.length && (
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>
                                                            {t('roles_needed_by').replace('{name}', requiredBy.map(label).join(', '))}
                                                        </div>
                                                    )}
                                                    {outside && (
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>{t('roles_not_in_package')}</div>
                                                    )}
                                                </label>
                                                {scopes.length > 1 ? (
                                                    <select
                                                        value={scope ?? ''}
                                                        disabled={disabled || !scope}
                                                        onChange={e => onChange(setGrant(grants, p, e.target.value as Scope))}
                                                        aria-label={t('who_can_scope')}
                                                        style={{ minWidth: '9rem' }}
                                                    >
                                                        {!scope && <option value="">—</option>}
                                                        {scopes.map(s => <option key={s} value={s}>{t(scopeLabelKey(s))}</option>)}
                                                    </select>
                                                ) : (
                                                    <span style={{ minWidth: '9rem', fontSize: '0.8rem', color: 'var(--text-soft)' }}>{t(scopeLabelKey(scopes[0]))}</span>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
