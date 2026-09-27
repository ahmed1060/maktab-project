'use client'

import { useState } from 'react'
import Modal from '@/components/Modal'
import PermissionMatrix from '@/components/PermissionMatrix'
import { useLanguage } from '@/context/LanguageContext'
import type { Grants } from '@/lib/permissions/grants'
import type { SerializedAccess } from '@/lib/features/bundles'
import { fromRows, toRows } from '@/lib/permissions/matrix'

/**
 * Creating or editing a company's role, or a role template — the same form:
 * name, description, base role and the permission matrix (ROLES_PLAN.md §6.1,
 * §6.2). The server decides; this says in advance what it will refuse (a
 * locked or built-in role, a held role's base) so nobody fills in a form to be
 * told no.
 */

export type BaseRole = 'ADMIN' | 'TEAM_LEADER' | 'EMPLOYEE'
type Rows = { permission: string; scope: string }[]
export type Template = { id: string; name: string; description: string | null; baseRole: BaseRole; grants: Rows }
export type EditableRole = {
    id?: string
    name: string
    description: string | null
    baseRole: BaseRole
    grants: Rows
    builtIn?: BaseRole | null
    holders?: number
    locked?: boolean
    copiedFromTemplateId?: string | null
}

export type RoleSubmission = {
    name: string
    description: string | null
    baseRole: BaseRole
    grants: Rows
    fromTemplateId?: string
    applyNow?: boolean
}

type Props = {
    isOpen: boolean
    onClose: () => void
    kind: 'role' | 'template'
    role: EditableRole | null
    /** For a new company role: templates to start from. */
    templates?: Template[]
    access?: SerializedAccess | null
    onSubmit: (submission: RoleSubmission) => Promise<boolean>
}

const BASE_ROLES: BaseRole[] = ['EMPLOYEE', 'TEAM_LEADER', 'ADMIN']
const BASE_LABEL: Record<BaseRole, string> = { ADMIN: 'role_admin', TEAM_LEADER: 'role_team_leader', EMPLOYEE: 'role_employee' }

export default function RoleEditorModal(props: Props) {
    // Keyed so each opening starts from the role as it is, not the last edit.
    if (!props.isOpen) return null
    return <Editor key={props.role?.id ?? 'new'} {...props} />
}

function Editor({ isOpen, onClose, kind, role, templates = [], access, onSubmit }: Props) {
    const { t, locale } = useLanguage()
    const isRtl = locale === 'ar'
    const isNew = !role?.id

    const [name, setName] = useState(role?.name ?? '')
    const [description, setDescription] = useState(role?.description ?? '')
    const [baseRole, setBaseRole] = useState<BaseRole>(role?.baseRole ?? 'EMPLOYEE')
    const [grants, setGrants] = useState<Grants>(fromRows(role?.grants ?? []))
    const [templateId, setTemplateId] = useState('')
    const [applyNow, setApplyNow] = useState(false)
    const [saving, setSaving] = useState(false)

    const locked = !!role?.locked
    const builtIn = !!role?.builtIn
    const holders = role?.holders ?? 0
    // A held role's base cannot move (§4.3), nor a built-in's.
    const baseFixed = builtIn || holders > 0
    const original = fromRows(role?.grants ?? [])
    const grantsChanged = JSON.stringify(Object.entries(grants).sort()) !== JSON.stringify(Object.entries(original).sort())
    const reachesHolders = !isNew && holders > 0 && (grantsChanged || baseRole !== role?.baseRole)
    const compareWith = role?.copiedFromTemplateId ? templates.find(tp => tp.id === role.copiedFromTemplateId) : null

    const startFrom = (id: string) => {
        setTemplateId(id)
        const template = templates.find(tp => tp.id === id)
        if (!template) return
        setBaseRole(template.baseRole)
        setGrants(fromRows(template.grants))
        if (!name) setName(template.name)
        if (!description && template.description) setDescription(template.description)
    }

    const submit = async () => {
        setSaving(true)
        try {
            const ok = await onSubmit({
                name: name.trim(), description: description.trim() || null, baseRole, grants: toRows(grants),
                ...(isNew && templateId ? { fromTemplateId: templateId } : {}),
                ...(reachesHolders && applyNow ? { applyNow: true } : {}),
            })
            if (ok) onClose()
        } finally {
            setSaving(false)
        }
    }

    const field = { display: 'flex', flexDirection: 'column' as const, gap: '0.3rem', marginBottom: '0.9rem' }
    const title = kind === 'template'
        ? (isNew ? t('role_templates_new') : role!.name)
        : (isNew ? t('roles_new') : role!.name)

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <div style={{ textAlign: isRtl ? 'right' : 'left', maxHeight: '70vh', overflowY: 'auto', paddingInlineEnd: '0.25rem' }}>
                {locked && (
                    <p style={{ padding: '0.75rem', borderRadius: '0.5rem', background: 'var(--panel-70)', fontSize: '0.85rem' }}>{t('roles_locked_hint')}</p>
                )}

                {isNew && kind === 'role' && templates.length > 0 && (
                    <div style={field}>
                        <label htmlFor="role-template">{t('roles_template')}</label>
                        <select id="role-template" className="input" value={templateId} onChange={e => startFrom(e.target.value)}>
                            <option value="">{t('roles_from_scratch')}</option>
                            {templates.map(tp => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
                        </select>
                    </div>
                )}

                <div style={field}>
                    <label htmlFor="role-name">{t('roles_name')}</label>
                    <input id="role-name" className="input" value={name} maxLength={60} disabled={builtIn} onChange={e => setName(e.target.value)} />
                </div>
                <div style={field}>
                    <label htmlFor="role-description">{t('roles_description')}</label>
                    <textarea id="role-description" className="input" value={description} maxLength={500} rows={2} disabled={locked} onChange={e => setDescription(e.target.value)} />
                </div>
                <div style={field}>
                    <label htmlFor="role-base">{t('roles_base_role')}</label>
                    <select id="role-base" className="input" value={baseRole} disabled={baseFixed} onChange={e => setBaseRole(e.target.value as BaseRole)}>
                        {BASE_ROLES.map(b => <option key={b} value={b}>{t(BASE_LABEL[b] as any)}</option>)}
                    </select>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>{t('roles_base_role_hint')}</span>
                </div>

                <PermissionMatrix
                    grants={grants}
                    onChange={setGrants}
                    disabled={locked}
                    access={access}
                    template={compareWith ? fromRows(compareWith.grants) : null}
                />

                {reachesHolders && (
                    <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '0.5rem', background: 'var(--warn-bg)', border: '1px solid var(--warn-border)' }}>
                        <strong>{t('roles_affects').replace('{count}', String(holders))}</strong>
                        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem', cursor: 'pointer' }}>
                            <input type="checkbox" checked={applyNow} onChange={e => setApplyNow(e.target.checked)} />
                            {t('roles_apply_now')}
                        </label>
                        {!applyNow && <div style={{ fontSize: '0.75rem', color: 'var(--text-soft)', marginTop: '0.25rem' }}>{t('roles_apply_later_hint')}</div>}
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem', flexDirection: isRtl ? 'row-reverse' : 'row' }}>
                <button type="button" className="btn" style={{ background: 'var(--border)', color: 'var(--text-strong)' }} onClick={onClose} disabled={saving}>{t('roles_cancel')}</button>
                <button type="button" className="btn btn-primary" onClick={submit} disabled={saving || locked || !name.trim()}>
                    {saving ? '…' : t('roles_save')}
                </button>
            </div>
        </Modal>
    )
}
