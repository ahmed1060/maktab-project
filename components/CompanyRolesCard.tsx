'use client'

import { Fragment, useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { CopyIcon, DownloadSimpleIcon, EyeIcon, HourglassIcon, PencilSimpleIcon, PlusIcon, StarIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, Card, Dialog, EmptyState, Icon, Row, RowMenu, StatusBadge, type MenuItem } from '@/components/ui'
import CopyRolesModal from '@/components/CopyRolesModal'
import AccessReviewSetting, { type ReviewSetting } from '@/components/AccessReviewSetting'
import RoleEditorModal, { type BaseRole, type EditableRole, type RoleSubmission, type Template } from '@/components/RoleEditorModal'
import type { SerializedAccess } from '@/lib/features/bundles'
import { countOf } from '@/lib/plural'
import { BUILT_IN_LABEL, roleLabel } from '@/lib/role-label'
import { useBusyAction } from '@/lib/useBusyAction'
import { useLeaveGuard } from '@/lib/useUnsavedChanges'

/**
 * A company's roles, in its settings (ROLES_PLAN.md §6.2): how many people hold
 * each, which one new accounts start on, and New role → from a template or
 * from scratch. The Super Admin's; the page already checks.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 4b):
 * a card with the roles as rows, what can be done to each in a menu named
 * for it, and the periodic access review in a card of its own.
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

    const { data, error, isValidating, mutate } = useSWR(`/api/roles?companyId=${companyId}`, fetcher)
    const { data: templatesData } = useSWR('/api/role-templates', fetcher)
    const roles: Role[] = data?.data?.roles ?? []
    const access: SerializedAccess | null = data?.data?.access ?? null
    const review: ReviewSetting | null = data?.data?.review ?? null
    const templates: Template[] = templatesData?.data ?? []

    const [editing, setEditing] = useState<Role | 'new' | null>(null)
    const [deleting, setDeleting] = useState<Role | null>(null)
    const [removing, setRemoving] = useState(false)
    const [copying, setCopying] = useState(false)
    const action = useBusyAction()
    const { update } = useSession()
    const router = useRouter()
    const leave = useLeaveGuard()

    // See the dashboard as a holder of this role would (§6.6). Read-only;
    // the note above every screen is the way out.
    const preview = async (role: Role) => {
        // The session comes back without the preview if the update failed:
        // stay, and say so, rather than open an ordinary dashboard (review on #49).
        const session = await update({ previewRoleId: role.id }).catch(() => null)
        if (!session?.user?.preview) return showToast(t('error_generic'), 'error')
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

    /** Deletes it; the dialog stays open, its button busy, until it's done. */
    const remove = async (role: Role) => {
        setRemoving(true)
        try {
            const res = await fetch(`/api/roles?id=${role.id}`, { method: 'DELETE' })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            showToast(t('roles_deleted'), 'success')
            setDeleting(null)
            mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setRemoving(false)
        }
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

    if (error && !data) return (
        <div className="ui-panel">
            <EmptyState icon={WarningCircleIcon} title={t('roles_load_failed')} detail={(error as SWRError).info?.error}
                action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
        </div>
    )
    if (!data) return <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>

    // Each fact kept apart from the next, so a name can't swap places with
    // the words beside it in Arabic, all in one span (part 3c).
    const facts = (items: (string | null)[]) => (
        <span>{items.filter(Boolean).map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}<bdi>{x}</bdi></Fragment>)}</span>
    )

    // Only what can be done to the role: the built-in Admin is never the
    // default, and a role that's the default, built in or held isn't deleted.
    const menu = (role: Role): MenuItem[] => [
        { key: 'edit', label: t('roles_edit'), icon: PencilSimpleIcon, onSelect: () => setEditing(role) },
        { key: 'preview', label: t('roles_preview'), icon: EyeIcon, onSelect: () => leave(() => preview(role)) },
        ...(!role.isDefault && role.baseRole !== 'ADMIN' ? [
            { key: 'default', label: t('roles_make_default'), icon: StarIcon, disabled: action.running, onSelect: () => { void action.run(`default-${role.id}`, () => makeDefault(role)) } },
        ] : []),
        ...(!role.builtIn && !role.isDefault && role.holders === 0 ? [
            { key: 'delete', label: t('roles_delete'), icon: TrashIcon, danger: true, onSelect: () => setDeleting(role) },
        ] : []),
    ]

    return (
        <>
            <Card
                title={t('roles_title')}
                actions={<>
                    {/* A file, so a plain link the browser fetches itself. */}
                    <a className="ui-btn ui-btn-secondary" href={`/api/roles/export?companyId=${companyId}&locale=${locale}`} download>
                        <Icon icon={DownloadSimpleIcon} size={18} />{t('roles_export')}
                    </a>
                    <Button icon={CopyIcon} onClick={() => setCopying(true)}>{t('roles_copy_from')}</Button>
                    <Button variant="primary" icon={PlusIcon} onClick={() => setEditing('new')}>{t('roles_new')}</Button>
                </>}
            >
                <p className="ui-card-note">{t('roles_hint')}</p>
                <ul className="ui-rows ui-rows-flush" aria-label={t('roles_title')}>
                    {roles.map(role => {
                        const name = roleLabel(role, t)
                        return (
                            <Row
                                key={role.id}
                                title={<>
                                    <bdi>{name}</bdi>
                                    {role.builtIn && <>{' '}<StatusBadge tone="neutral">{t('roles_built_in')}</StatusBadge></>}
                                    {role.locked && <>{' '}<StatusBadge tone="neutral">{t('roles_locked')}</StatusBadge></>}
                                    {role.isDefault && <>{' '}<StatusBadge tone="good">{t('roles_default')}</StatusBadge></>}
                                </>}
                                // A built-in role is its own base: said only of the others.
                                detail={facts([
                                    role.builtIn ? null : t('roles_based_on').replace('{role}', t(BUILT_IN_LABEL[role.baseRole])),
                                    countOf(t, locale, role.holders, 'employees'),
                                    countOf(t, locale, role.grants.length, 'permissions'),
                                ])}
                                end={<RowMenu label={t('ui_more_actions_for').replace('{name}', name)} tooltip={t('ui_more_actions')} items={menu(role)} />}
                            />
                        )
                    })}
                </ul>
            </Card>

            {/* Remounted when the saved setting changes, so it starts from it. */}
            {review && (
                <AccessReviewSetting
                    key={`${review.accessReviewEnabled}-${review.accessReviewMonths}`}
                    companyId={companyId}
                    setting={review}
                    onSaved={() => mutate()}
                />
            )}

            <RoleEditorModal
                isOpen={editing !== null}
                onClose={() => setEditing(null)}
                kind="role"
                role={editing === 'new' ? null : editing}
                templates={templates}
                access={access}
                onSubmit={save}
            />

            <CopyRolesModal companyId={companyId} isOpen={copying} onClose={() => setCopying(false)} onCopied={() => mutate()} />

            {deleting && (
                <DeleteRoleDialog name={roleLabel(deleting, t)} busy={removing}
                    onCancel={() => setDeleting(null)} onConfirm={() => { void remove(deleting) }} />
            )}
        </>
    )
}

/** Deleting a role nobody holds: asked first, in the danger colour. */
export function DeleteRoleDialog({ name, busy, onCancel, onConfirm }: { name: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
    const { t } = useLanguage()
    return (
        <Dialog
            open
            onClose={() => { if (!busy) onCancel() }}
            title={t('roles_delete_title').replace('{name}', name)}
            actions={<>
                <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
                <Button variant="danger" busy={busy} onClick={onConfirm}>{t('roles_delete')}</Button>
            </>}
        >
            <p>{t('roles_delete_body')}</p>
        </Dialog>
    )
}
