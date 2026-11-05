'use client'

import { Fragment, useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { HourglassIcon, MegaphoneIcon, PencilSimpleIcon, PlusIcon, ShieldIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import DeleteTemplateDialog from '@/components/DeleteTemplateDialog'
import TemplateOfferModal from '@/components/TemplateOfferModal'
import RoleEditorModal, { type RoleSubmission, type Template } from '@/components/RoleEditorModal'
import { refusalOf } from '@/components/CompanyRolesCard'
import { Button, EmptyState, Page, PageHeader, Row, RowMenu, Rows, type MenuItem } from '@/components/ui'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { BUILT_IN_LABEL } from '@/lib/role-label'
import { countOf } from '@/lib/plural'

/**
 * Role templates (ROLES_PLAN.md §6.1): the Super Admin's library of roles to
 * copy into companies. A copy is never a link — editing a template changes no
 * company's role.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, the Super Admin's pages part
 * 1): the page header with New template, the templates as rows with what each
 * is for under them, and a menu on each; deleting one asks first.
 */
export default function RoleTemplatesPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { data: session, status } = useSession()
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

    const { data, error, isValidating, mutate } = useSWR(isSuperAdmin ? '/api/role-templates' : null, fetcher)
    const templates: Template[] | null = data ? data.data ?? [] : null
    const [editing, setEditing] = useState<Template | 'new' | null>(null)
    const [deleting, setDeleting] = useState<Template | null>(null)
    const [removing, setRemoving] = useState(false)
    const [offering, setOffering] = useState<Template | null>(null)

    if (status === 'loading') return null
    if (!isSuperAdmin) return <AccessDenied superAdmins />

    const save = async (submission: RoleSubmission): Promise<boolean> => {
        const isNew = editing === 'new'
        const { name, description, baseRole, grants, acknowledgeConflicts } = submission
        try {
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
        } catch {
            showToast(t('error_generic'), 'error')
            return false
        }
        showToast(t('role_templates_saved'), 'success')
        await mutate()
        return true
    }

    /** Deletes a template; the dialog stays open, its button busy, until it's done. */
    const remove = async (template: Template) => {
        setRemoving(true)
        try {
            const res = await fetch(`/api/role-templates?id=${template.id}`, { method: 'DELETE' })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            showToast(t('role_templates_deleted'), 'success')
            setDeleting(null)
            await mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setRemoving(false)
        }
    }

    // Each fact kept apart from the next, so a name can't swap places with
    // the words beside it in Arabic (company settings part 3c).
    const facts = (items: ReactNode[]) => (
        <span>{items.map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}<bdi>{x}</bdi></Fragment>)}</span>
    )

    const menu = (template: Template): MenuItem[] => [
        { key: 'edit', label: t('roles_edit'), icon: PencilSimpleIcon, onSelect: () => setEditing(template) },
        { key: 'offer', label: t('template_offer'), icon: MegaphoneIcon, onSelect: () => setOffering(template) },
        { key: 'delete', label: t('roles_delete'), icon: TrashIcon, danger: true, onSelect: () => setDeleting(template) },
    ]

    return (
        <Page>
            <PageHeader
                title={t('role_templates_title')}
                subtitle={t('role_templates_hint')}
                action={<Button variant="primary" icon={PlusIcon} onClick={() => setEditing('new')}>{t('role_templates_new')}</Button>}
            />

            {!templates ? (
                error ? (
                    <div className="ui-panel">
                        <EmptyState icon={WarningCircleIcon} title={t('role_templates_load_failed')} detail={(error as SWRError).info?.error}
                            action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    </div>
                ) : (
                    <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
                )
            ) : templates.length === 0 ? (
                // New template is the header's, right above: offered once.
                <div className="ui-panel"><EmptyState icon={ShieldIcon} title={t('role_templates_empty')} /></div>
            ) : (
                // A panel of rows: a card with no title kept its padding above them (audit on part 1).
                <Rows label={t('role_templates_title')}>
                        {templates.map(template => (
                            <Row
                                key={template.id}
                                title={<bdi>{template.name}</bdi>}
                                detail={facts([
                                    t('roles_based_on').replace('{role}', t(BUILT_IN_LABEL[template.baseRole])),
                                    countOf(t, locale, template.grants.length, 'permissions'),
                                ])}
                                // Written in either language: kept in its own direction (audit on part 1).
                                note={template.description && <bdi>{template.description}</bdi>}
                                end={<RowMenu label={t('ui_more_actions_for').replace('{name}', template.name)} tooltip={t('ui_more_actions')} items={menu(template)} />}
                            />
                        ))}
                </Rows>
            )}

            <RoleEditorModal
                isOpen={editing !== null}
                onClose={() => setEditing(null)}
                kind="template"
                role={editing === 'new' ? null : editing}
                onSubmit={save}
            />

            <TemplateOfferModal template={offering} onClose={() => setOffering(null)} />

            {deleting && (
                <DeleteTemplateDialog name={deleting.name} body={t('role_templates_delete_body')} busy={removing}
                    onCancel={() => setDeleting(null)} onConfirm={() => { void remove(deleting) }} />
            )}
        </Page>
    )
}
