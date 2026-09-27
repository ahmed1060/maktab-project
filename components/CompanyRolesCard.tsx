'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import ConfirmModal from '@/components/ConfirmModal'
import RoleEditorModal, { type BaseRole, type EditableRole, type RoleSubmission, type Template } from '@/components/RoleEditorModal'
import type { SerializedAccess } from '@/lib/features/bundles'

/**
 * A company's roles, in its settings (ROLES_PLAN.md §6.2): how many people hold
 * each, which one new accounts start on, and New role → from a template or
 * from scratch. The Super Admin's; the page already checks.
 */

type Role = EditableRole & { id: string; companyId: string; version: number; isDefault: boolean; holders: number; locked: boolean; builtIn: BaseRole | null }

const BASE_LABEL: Record<BaseRole, string> = { ADMIN: 'role_admin', TEAM_LEADER: 'role_team_leader', EMPLOYEE: 'role_employee' }

/** The refusal the server gave, with every reason a grant was refused. */
export async function refusalOf(res: Response, fallback: string): Promise<string> {
    const body = await res.json().catch(() => ({}))
    const reasons: string[] = body?.details?.errors ?? []
    return [body?.error || fallback, ...reasons].join(' — ')
}

export default function CompanyRolesCard({ companyId }: { companyId: string }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const isRtl = locale === 'ar'

    const { data, mutate } = useSWR(`/api/roles?companyId=${companyId}`, fetcher)
    const { data: templatesData } = useSWR('/api/role-templates', fetcher)
    const roles: Role[] = data?.data?.roles ?? []
    const access: SerializedAccess | null = data?.data?.access ?? null
    const templates: Template[] = templatesData?.data ?? []

    const [editing, setEditing] = useState<Role | 'new' | null>(null)
    const [deleting, setDeleting] = useState<Role | null>(null)

    const save = async (submission: RoleSubmission): Promise<boolean> => {
        const isNew = editing === 'new'
        const role = isNew ? null : editing as Role
        // Only what the server lets change: a built-in role keeps its name and
        // base, and a role's grants are sent only when they are the point.
        const body = isNew
            ? { companyId, ...submission }
            : {
                id: role!.id,
                ...(role!.builtIn ? {} : { name: submission.name }),
                description: submission.description,
                ...(submission.baseRole !== role!.baseRole ? { baseRole: submission.baseRole } : {}),
                grants: submission.grants,
                ...(submission.applyNow ? { applyNow: true } : {}),
            }
        const res = await fetch('/api/roles', {
            method: isNew ? 'POST' : 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        if (!res.ok) {
            showToast(await refusalOf(res, t('error_generic')), 'error')
            return false
        }
        showToast(t('roles_saved'), 'success')
        mutate()
        return true
    }

    const remove = async (role: Role) => {
        setDeleting(null)
        const res = await fetch(`/api/roles?id=${role.id}`, { method: 'DELETE' })
        if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
        showToast(t('roles_deleted'), 'success')
        mutate()
    }

    const makeDefault = async (role: Role) => {
        const res = await fetch('/api/roles/default', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyId, roleId: role.builtIn === 'EMPLOYEE' ? null : role.id }),
        })
        if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
        showToast(t('roles_default_saved'), 'success')
        mutate()
    }

    const badge = (text: string) => (
        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: '999px', background: 'var(--veil-50)', border: '1px solid var(--veil-40)' }}>{text}</span>
    )
    const linkButton = { background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: 0, font: 'inherit', fontSize: '0.85rem' }

    return (
        <div className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', textAlign: isRtl ? 'right' : 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexDirection: isRtl ? 'row-reverse' : 'row' }}>
                <div>
                    <h3 style={{ margin: 0 }}>{t('roles_title')}</h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginTop: '0.25rem' }}>{t('roles_hint')}</p>
                </div>
                <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>{t('roles_new')}</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
                {roles.map(role => (
                    <div key={role.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid var(--veil-40)', flexWrap: 'wrap', flexDirection: isRtl ? 'row-reverse' : 'row' }}>
                        <div style={{ flex: 1, minWidth: '12rem' }}>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <strong>{role.name}</strong>
                                {role.builtIn && badge(t('roles_built_in'))}
                                {role.locked && badge(t('roles_locked'))}
                                {role.isDefault && badge(t('roles_default'))}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)' }}>
                                {t(BASE_LABEL[role.baseRole] as any)} · {t('roles_holders').replace('{count}', String(role.holders))} · {t('roles_selected').replace('{count}', String(role.grants.length))}
                            </div>
                        </div>
                        <button type="button" style={linkButton} onClick={() => setEditing(role)}>{t('roles_edit')}</button>
                        {!role.isDefault && role.baseRole !== 'ADMIN' && (
                            <button type="button" style={linkButton} onClick={() => makeDefault(role)}>{t('roles_make_default')}</button>
                        )}
                        {!role.builtIn && !role.isDefault && role.holders === 0 && (
                            <button type="button" style={{ ...linkButton, color: 'var(--danger-solid)' }} onClick={() => setDeleting(role)}>{t('roles_delete')}</button>
                        )}
                    </div>
                ))}
            </div>

            <RoleEditorModal
                isOpen={editing !== null}
                onClose={() => setEditing(null)}
                kind="role"
                role={editing === 'new' ? null : editing}
                templates={templates}
                access={access}
                onSubmit={save}
            />

            <ConfirmModal
                isOpen={!!deleting}
                title={t('roles_delete')}
                message={t('roles_delete_confirm').replace('{name}', deleting?.name ?? '')}
                variant="danger"
                onConfirm={() => deleting && remove(deleting)}
                onCancel={() => setDeleting(null)}
            />
        </div>
    )
}
