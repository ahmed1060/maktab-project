'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import ConfirmModal from '@/components/ConfirmModal'
import LoadingSpinner from '@/components/LoadingSpinner'
import TemplateOfferModal from '@/components/TemplateOfferModal'
import RoleEditorModal, { type BaseRole, type RoleSubmission, type Template } from '@/components/RoleEditorModal'
import { refusalOf } from '@/components/CompanyRolesCard'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import { fetcher } from '@/lib/swr-fetcher'

const BASE_LABEL: Record<BaseRole, string> = { ADMIN: 'role_admin', TEAM_LEADER: 'role_team_leader', EMPLOYEE: 'role_employee' }

/**
 * Role templates (ROLES_PLAN.md §6.1): the Super Admin's library of roles to
 * copy into companies. A copy is never a link — editing a template changes no
 * company's role.
 */
export default function RoleTemplatesPage() {
    const { t, locale } = useLanguage()
    const isRtl = locale === 'ar'
    const { setTitle, setSubtitle } = useHeader()
    const { showToast } = useToast()
    const { data: session } = useSession()
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

    const { data, isLoading, mutate } = useSWR(isSuperAdmin ? '/api/role-templates' : null, fetcher)
    const templates: Template[] = data?.data ?? []
    const [editing, setEditing] = useState<Template | 'new' | null>(null)
    const [deleting, setDeleting] = useState<Template | null>(null)
    const [offering, setOffering] = useState<string | null>(null)

    useEffect(() => {
        setTitle(t('role_templates_title'))
        setSubtitle(t('role_templates_hint'))
        return () => { setTitle(null); setSubtitle(null) }
    }, [t, setTitle, setSubtitle])

    if (session && !isSuperAdmin) return <AccessDenied />

    const save = async (submission: RoleSubmission): Promise<boolean> => {
        const isNew = editing === 'new'
        const { name, description, baseRole, grants, acknowledgeConflicts } = submission
        const res = await fetch('/api/role-templates', {
            method: isNew ? 'POST' : 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(isNew
                ? { name, description, baseRole, grants, acknowledgeConflicts }
                : { id: (editing as Template).id, name, description, baseRole, grants, acknowledgeConflicts }),
        })
        if (!res.ok) {
            showToast(await refusalOf(res, t('error_generic')), 'error')
            return false
        }
        showToast(t('role_templates_saved'), 'success')
        mutate()
        return true
    }

    const remove = async (template: Template) => {
        setDeleting(null)
        const res = await fetch(`/api/role-templates?id=${template.id}`, { method: 'DELETE' })
        if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
        showToast(t('role_templates_deleted'), 'success')
        mutate()
    }

    const linkButton = { background: 'none', border: 'none', color: 'var(--brand-primary-text)', cursor: 'pointer', padding: 0, font: 'inherit', fontSize: '0.85rem' }

    return (
        <div style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>{t('role_templates_new')}</button>
            </div>

            {isLoading ? <LoadingSpinner /> : templates.length === 0 ? (
                <div className="glass" style={{ padding: '2rem', borderRadius: '1rem', textAlign: 'center', color: 'var(--text-soft)' }}>{t('role_templates_empty')}</div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(18rem, 1fr))', gap: '1rem' }}>
                    {templates.map(template => (
                        <div key={template.id} className="glass" style={{ padding: '1.25rem', borderRadius: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <strong>{template.name}</strong>
                            {template.description && <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-soft)' }}>{template.description}</p>}
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)' }}>
                                {t(BASE_LABEL[template.baseRole] as any)} · {t('roles_selected').replace('{count}', String(template.grants.length))}
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', marginTop: 'auto' }}>
                                <button type="button" style={linkButton} onClick={() => setEditing(template)}>{t('roles_edit')}</button>
                                <button type="button" style={linkButton} onClick={() => setOffering(template.id)}>{t('template_offer')}</button>
                                <button type="button" style={{ ...linkButton, color: 'var(--danger-fg-strong)' }} onClick={() => setDeleting(template)}>{t('roles_delete')}</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <RoleEditorModal
                isOpen={editing !== null}
                onClose={() => setEditing(null)}
                kind="template"
                role={editing === 'new' ? null : editing}
                onSubmit={save}
            />

            <TemplateOfferModal templateId={offering} onClose={() => setOffering(null)} />

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
