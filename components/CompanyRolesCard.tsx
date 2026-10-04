'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { fetcher } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import ConfirmModal from '@/components/ConfirmModal'
import CopyRolesModal from '@/components/CopyRolesModal'
import AccessReviewSetting, { type ReviewSetting } from '@/components/AccessReviewSetting'
import RoleEditorModal, { type BaseRole, type EditableRole, type RoleSubmission, type Template } from '@/components/RoleEditorModal'
import type { SerializedAccess } from '@/lib/features/bundles'
import { BUILT_IN_LABEL, roleLabel } from '@/lib/role-label'

/**
 * A company's roles, in its settings (ROLES_PLAN.md §6.2): how many people hold
 * each, which one new accounts start on, and New role → from a template or
 * from scratch. The Super Admin's; the page already checks.
 */

type Role = EditableRole & { id: string; companyId: string; version: number; isDefault: boolean; holders: number; locked: boolean; builtIn: BaseRole | null }

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
    const review: ReviewSetting | null = data?.data?.review ?? null
    const templates: Template[] = templatesData?.data ?? []

    const [editing, setEditing] = useState<Role | 'new' | null>(null)
    const [deleting, setDeleting] = useState<Role | null>(null)
    const [copying, setCopying] = useState(false)
    const { update } = useSession()
    const router = useRouter()

    // See the dashboard as a holder of this role would (§6.6). Read-only;
    // the banner on every screen is the way out.
    const preview = async (role: Role) => {
        await update({ previewRoleId: role.id })
        // Refreshed, so the layout reads the session as the preview presents it.
        router.push('/dashboard')
        router.refresh()
    }

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
                ...(submission.acknowledgeConflicts ? { acknowledgeConflicts: true } : {}),
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
    const linkButton = { background: 'none', border: 'none', color: 'var(--brand-primary-text)', cursor: 'pointer', padding: 0, font: 'inherit', fontSize: '0.85rem' }

    return (
        <div className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', textAlign: isRtl ? 'right' : 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexDirection: isRtl ? 'row-reverse' : 'row' }}>
                <div>
                    <h3 style={{ margin: 0 }}>{t('roles_title')}</h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginTop: '0.25rem' }}>{t('roles_hint')}</p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <a className="btn" style={{ background: 'var(--border)', color: 'var(--text-strong)', textDecoration: 'none' }} href={`/api/roles/export?companyId=${companyId}&locale=${locale}`} download>{t('roles_export')}</a>
                    <button type="button" className="btn" style={{ background: 'var(--border)', color: 'var(--text-strong)' }} onClick={() => setCopying(true)}>{t('roles_copy_from')}</button>
                    <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>{t('roles_new')}</button>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
                {roles.map(role => (
                    <div key={role.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid var(--veil-40)', flexWrap: 'wrap', flexDirection: isRtl ? 'row-reverse' : 'row' }}>
                        <div style={{ flex: 1, minWidth: '12rem' }}>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <strong>{roleLabel(role, t)}</strong>
                                {role.builtIn && badge(t('roles_built_in'))}
                                {role.locked && badge(t('roles_locked'))}
                                {role.isDefault && badge(t('roles_default'))}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)' }}>
                                {t(BUILT_IN_LABEL[role.baseRole])} · {t('roles_holders').replace('{count}', String(role.holders))} · {t('roles_selected').replace('{count}', String(role.grants.length))}
                            </div>
                        </div>
                        <button type="button" style={linkButton} onClick={() => setEditing(role)}>{t('roles_edit')}</button>
                        <button type="button" style={linkButton} onClick={() => preview(role)}>{t('roles_preview')}</button>
                        {!role.isDefault && role.baseRole !== 'ADMIN' && (
                            <button type="button" style={linkButton} onClick={() => makeDefault(role)}>{t('roles_make_default')}</button>
                        )}
                        {!role.builtIn && !role.isDefault && role.holders === 0 && (
                            <button type="button" style={{ ...linkButton, color: 'var(--danger-fg-strong)' }} onClick={() => setDeleting(role)}>{t('roles_delete')}</button>
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

            {/* Remounted when the saved setting changes, so it starts from it. */}
            {review && (
                <AccessReviewSetting
                    key={`${review.accessReviewEnabled}-${review.accessReviewMonths}`}
                    companyId={companyId}
                    setting={review}
                    onSaved={() => mutate()}
                />
            )}

            <CopyRolesModal companyId={companyId} isOpen={copying} onClose={() => setCopying(false)} onCopied={() => mutate()} />

            <ConfirmModal
                isOpen={!!deleting}
                title={t('roles_delete')}
                message={t('roles_delete_confirm').replace('{name}', deleting ? roleLabel(deleting, t) : '')}
                variant="danger"
                onConfirm={() => deleting && remove(deleting)}
                onCancel={() => setDeleting(null)}
            />
        </div>
    )
}
