'use client'

import { useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { EnvelopeSimpleIcon, HourglassIcon, PencilSimpleIcon, PlusIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import { refusalOf } from '@/components/CompanyRolesCard'
import DeleteTemplateDialog from '@/components/DeleteTemplateDialog'
import { AddSuperAdminDialog, EditSuperAdminDialog, type SuperAdmin } from '@/components/SuperAdminDialogs'
import { Button, DataList, EmptyState, ItemTitle, ListCard, Page, PageHeader, Pager, RowMenu, StatusBadge, pageInRange, type Column, type MenuItem } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useViewer } from '@/lib/useCan'

/**
 * The Super Admins (the Super Admin's pages part 2b, UI_PLAN.md §5 step 5):
 * a list, a table on computers and cards on phones, with Add a Super Admin in
 * the page header. You edit yourself; a protected Super Admin edits the
 * others, and deletes any that isn't protected. The server enforces the same.
 *
 * There's no status: the server sends every Super Admin as active, so the
 * "Online" it showed was never true (part 2b). Nor the dialog that only
 * repeated a row's name and email.
 */
const LIMIT = 10

export default function SuperAdminsPage() {
    const { t } = useLanguage()
    const { showToast } = useToast()
    // Who is looking comes from the layout on the first paint, so a Super
    // Admin never sees "Access restricted" while the session loads.
    const viewer = useViewer()
    const isSuperAdmin = viewer?.role === 'SUPER_ADMIN'
    const [page, setPage] = useState(1)
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<SuperAdmin | null>(null)
    const [deleting, setDeleting] = useState<SuperAdmin | null>(null)
    const [busy, setBusy] = useState(false)

    const { data, error, isValidating, mutate } = useSWR(isSuperAdmin ? `/api/super-admins?page=${page}&limit=${LIMIT}` : null, fetcher)
    const admins: SuperAdmin[] | null = data ? data.data?.data ?? [] : null
    const pageCount: number = data?.data?.totalPages ?? 1

    if (!isSuperAdmin) return <AccessDenied superAdmins />

    const name = (a: SuperAdmin) => `${a.firstName} ${a.lastName}`
    const remove = async (admin: SuperAdmin) => {
        setBusy(true)
        try {
            const res = await fetch(`/api/super-admins/${admin.id}`, { method: 'DELETE' })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            showToast(t('super_admins_deleted').replace('{name}', name(admin)), 'success')
            setDeleting(null)
            // The last on its page gone, the page before it is shown.
            if (admins?.length === 1 && page > 1) setPage(pageInRange(page - 1, pageCount))
            await mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }

    const menu = (a: SuperAdmin): ReactNode => {
        const items: MenuItem[] = [
            ...(a.id === viewer?.id || viewer?.isProtected ? [{ key: 'edit', label: t('edit'), icon: PencilSimpleIcon, onSelect: () => setEditing(a) }] : []),
            ...(viewer?.isProtected && !a.isProtected ? [{ key: 'delete', label: t('delete'), icon: TrashIcon, danger: true, onSelect: () => setDeleting(a) }] : []),
        ]
        return items.length > 0 && <RowMenu label={t('ui_more_actions_for').replace('{name}', name(a))} tooltip={t('ui_more_actions')} items={items} />
    }
    const protectedBadge = (a: SuperAdmin) => a.isProtected && <StatusBadge tone="neutral">{t('super_admins_protected')}</StatusBadge>

    const columns: Column<SuperAdmin>[] = [
        { key: 'name', header: t('super_admins_name'), cell: a => <ItemTitle title={<><bdi>{name(a)}</bdi>{a.isProtected && ' '}{protectedBadge(a)}</>} /> },
        { key: 'email', header: t('email'), cell: a => <bdi>{a.email}</bdi> },
        { key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end', cell: menu },
    ]

    let list: ReactNode
    if (!admins) {
        list = error ? (
            <div className="ui-panel">
                <EmptyState icon={WarningCircleIcon} title={t('super_admins_load_failed')} detail={(error as SWRError).info?.error}
                    action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
            </div>
        ) : (
            <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        )
    } else {
        list = (
            <DataList
                caption={t('super_admins')}
                columns={columns}
                rows={admins}
                rowKey={a => a.id}
                card={a => (
                    <ListCard
                        title={<bdi>{name(a)}</bdi>}
                        status={protectedBadge(a)}
                        details={[{ icon: EnvelopeSimpleIcon, text: <bdi>{a.email}</bdi> }]}
                        foot={menu(a) && <><span />{menu(a)}</>}
                    />
                )}
                footer={pageCount > 1 && <Pager page={page} pageCount={pageCount} onPage={setPage} />}
            />
        )
    }

    return (
        <Page>
            <PageHeader
                title={t('super_admins')}
                subtitle={t('super_admins_hint')}
                action={<Button variant="primary" icon={PlusIcon} onClick={() => setAdding(true)}>{t('super_admins_add')}</Button>}
            />
            {list}

            {adding && (
                <AddSuperAdminDialog
                    onClose={() => setAdding(false)}
                    onAdded={added => {
                        setAdding(false)
                        showToast(t('super_admins_added').replace('{name}', added), 'success')
                        void mutate()
                    }}
                />
            )}
            {editing && (
                <EditSuperAdminDialog
                    admin={editing}
                    onClose={() => setEditing(null)}
                    onSaved={saved => {
                        setEditing(null)
                        showToast(t('super_admins_saved').replace('{name}', saved), 'success')
                        void mutate()
                    }}
                />
            )}
            {deleting && (
                <DeleteTemplateDialog
                    name={name(deleting)}
                    body={t('super_admins_delete_body')}
                    busy={busy}
                    onCancel={() => setDeleting(null)}
                    onConfirm={() => { void remove(deleting) }}
                />
            )}
        </Page>
    )
}
