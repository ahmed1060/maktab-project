'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { usePathname, useSearchParams } from 'next/navigation'
import {
    BuildingsIcon, EnvelopeSimpleIcon, HourglassIcon, IdentificationBadgeIcon, LockIcon, MagnifyingGlassIcon, ShieldCheckIcon, TrashIcon,
    UserMinusIcon, UsersIcon, WarningCircleIcon,
} from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import { refusalOf } from '@/components/CompanyRolesCard'
import DeleteTemplateDialog from '@/components/DeleteTemplateDialog'
import { SignInLock } from '@/components/SignInLock'
import {
    Avatar, Button, ButtonLink, DataList, EmptyState, Field, FilterBar, ItemTitle, ListCard, Page, PageHeader, Pager, RowMenu,
    SearchInput, Select, StatusBadge, TabLinks, pageInRange, type Column,
} from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { STATUS_TONE, STATUS_WORD } from '@/lib/person-status'
import { countOf } from '@/lib/plural'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { forScope, loadFailed, scopedFetcher, scopedKey } from '@/lib/swr-scoped'
import type { TranslationKey } from '@/lib/translations'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useViewer } from '@/lib/useCan'

/**
 * All users (the Super Admin's pages part 3c, UI_PLAN.md §5 step 5): everyone
 * in every company, a table on computers and cards on phones, found by name,
 * email or company and narrowed to one company. Those who have left are the
 * other tab, kept in the address (`?show=left`), where it was a window of its
 * own; only the Super Admin deletes them for good. The Super Admins are on
 * their own page, linked from the header, where they were a table of their
 * own on this page's first page.
 */
type Person = {
    id: string
    firstName: string
    lastName: string
    email: string
    username?: string | null
    role: string
    status: string
    totalDifficultyPoints: number
    company?: { id: string; name: string } | null
    // When they can sign in again, if they're locked out now (lib/sign-in-lock.ts).
    signInLockedUntil?: string | null
    ownPasswordPausedUntil?: string | null
}
type Listed = { data: Person[]; total: number; page: number; totalPages: number }
const LIMIT = 10

/** The email someone had: deleting someone keeps it under a suffix, so the address is free again. */
const emailOf = (p: Person) => p.email.split('_DELETED_')[0]

export default function AllUsersPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    // Who is looking comes from the layout on the first paint, so a Super
    // Admin never sees "Access restricted" while the session loads.
    const viewer = useViewer()
    const isSuperAdmin = viewer?.role === 'SUPER_ADMIN'
    const params = useSearchParams()
    const pathname = usePathname()
    const left = params.get('show') === 'left'

    const [companyId, setCompanyId] = useState('')
    // Asked of the server a moment after the typing stops, not per letter.
    const [typed, setTyped] = useState('')
    const [search, setSearch] = useState('')
    useEffect(() => {
        const id = setTimeout(() => setSearch(typed.trim()), 250)
        return () => clearTimeout(id)
    }, [typed])
    // Another tab, company or search starts from its first page, in the same
    // render, so the first request for it already asks for page 1.
    const [page, setPage] = useState(1)
    const filters = `${left}/${companyId}/${search}`
    useAdjustOnChange([filters], () => setPage(1))

    const [removing, setRemoving] = useState<Person | null>(null)
    const [busy, setBusy] = useState(false)

    const { data: companiesResult } = useSWR(isSuperAdmin ? '/api/companies?limit=1000&filter=all&sort=name' : null, fetcher)
    const companies: { id: string; name: string }[] = companiesResult?.data?.data ?? []

    // The rows stay up while the next page or search loads, each answer
    // tagged with what it was asked for: one that failed says so, rather than
    // leave the last one's rows under the new search. Not across tabs or
    // companies: the people at work drawn as Left rows, or another company's,
    // would carry a Delete for good for someone it isn't for (Codex on PR 173).
    const scope = `${left ? 'left' : 'at-work'}/${companyId}`
    const listUrl = isSuperAdmin
        ? `/api/users?page=${page}&limit=${LIMIT}${left ? '&status=DELETED' : ''}&companyId=${encodeURIComponent(companyId)}&search=${encodeURIComponent(search)}`
        : null
    const { data, error, isValidating, mutate } = useSWR(scopedKey(listUrl, scope), scopedFetcher, { keepPreviousData: true })
    const failed = loadFailed(data, error, listUrl)
    const listed: Listed | null = failed ? null : forScope(data, scope)?.data ?? null
    // Fewer pages than the one shown, as when the last person on it is
    // deleted for good: the last page there is now.
    const pageCount = listed?.totalPages
    useAdjustOnChange([pageCount], () => { if (pageCount !== undefined) setPage(p => pageInRange(p, pageCount)) })

    if (!isSuperAdmin) return <AccessDenied superAdmins />

    const nameOf = (p: Person) => `${p.firstName} ${p.lastName}`
    const roleWord = (r: string) => t(`role_${r.toLowerCase()}` as TranslationKey) || r
    const companyOf = (p: Person) => p.company ? <bdi>{p.company.name}</bdi> : t('all_users_no_company')
    const statusBadge = (p: Person) => <StatusBadge tone={STATUS_TONE[p.status] ?? 'neutral'}>{STATUS_WORD[p.status] ? t(STATUS_WORD[p.status]) : p.status}</StatusBadge>
    // Locked out of signing in, with Unlock, under the status (decided 2026-11-03).
    const lock = (p: Person) => <SignInLock personId={p.id} name={nameOf(p)} until={p.signInLockedUntil} paused={p.ownPasswordPausedUntil} onUnlocked={() => { void mutate() }} />
    // An Admin isn't scored, as on the Employees list.
    const points = (p: Person) => p.role === 'ADMIN' ? null : <span className="ui-chip">{countOf(t, locale, p.totalDifficultyPoints || 0, 'pts')}</span>
    const profile = (p: Person, label: ReactNode) => <Link href={`/dashboard/employees/${p.id}?mode=view`} prefetch={false} className="ui-item-link">{label}</Link>

    const remove = async (u: Person) => {
        setBusy(true)
        try {
            // The server asks for a recent authenticator code first, and the
            // code prompt asks for it and sends this again.
            const res = await fetch(`/api/users?id=${encodeURIComponent(u.id)}&permanent=true`, { method: 'DELETE' })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            showToast(t('all_users_deleted').replace('{name}', emailOf(u)), 'success')
            setRemoving(null)
            await mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }
    const menu = (p: Person) => (
        <RowMenu label={t('ui_more_actions_for').replace('{name}', emailOf(p))} tooltip={t('ui_more_actions')}
            items={[{ key: 'delete', label: t('all_users_delete_for_good'), icon: TrashIcon, danger: true, onSelect: () => setRemoving(p) }]} />
    )

    const current: Column<Person>[] = [
        {
            key: 'name', header: t('name_label'), cell: p => (
                <div className="ui-person">
                    <Avatar name={nameOf(p)} />
                    <div><ItemTitle title={profile(p, nameOf(p))} detail={<bdi>{p.email}</bdi>} /></div>
                </div>
            ),
        },
        { key: 'company', header: t('company_label'), cell: companyOf },
        { key: 'username', header: t('username_label'), cell: p => p.username && <bdi>{p.username}</bdi> },
        { key: 'role', header: t('role_label'), cell: p => roleWord(p.role) },
        { key: 'points', header: t('points_label'), cell: points },
        { key: 'status', header: t('status_label'), cell: p => <>{statusBadge(p)}{lock(p)}</> },
    ]
    // Someone who has left is named "Ghost User" and their username a
    // placeholder, so they're shown by the email they had.
    const gone: Column<Person>[] = [
        { key: 'name', header: t('email'), cell: p => <ItemTitle title={profile(p, <bdi>{emailOf(p)}</bdi>)} /> },
        { key: 'company', header: t('company_label'), cell: companyOf },
        { key: 'role', header: t('role_label'), cell: p => roleWord(p.role) },
        { key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end', cell: menu },
    ]

    const empty = search || companyId
        ? <EmptyState icon={MagnifyingGlassIcon} title={t('all_users_none_match')} />
        : left
            ? <EmptyState icon={UserMinusIcon} title={t('all_users_left_none')} />
            : <EmptyState icon={UsersIcon} title={t('all_users_none')} />

    let list: ReactNode
    if (!listed) {
        list = failed ? (
            <div className="ui-panel">
                <EmptyState icon={WarningCircleIcon} title={t('all_users_load_failed')} detail={(error as SWRError).info?.error}
                    action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
            </div>
        ) : (
            <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        )
    } else {
        list = (
            <DataList
                caption={left ? t('all_users_tab_left') : t('all_users')}
                columns={left ? gone : current}
                rows={listed.data}
                rowKey={p => p.id}
                empty={empty}
                card={p => left ? (
                    <ListCard
                        title={profile(p, <bdi>{emailOf(p)}</bdi>)}
                        details={[{ icon: BuildingsIcon, text: companyOf(p) }, { icon: IdentificationBadgeIcon, text: roleWord(p.role) }]}
                        foot={<span className="ui-row-actions">{menu(p)}</span>}
                    />
                ) : (
                    <ListCard
                        title={profile(p, nameOf(p))}
                        status={statusBadge(p)}
                        details={[
                            { icon: EnvelopeSimpleIcon, text: <bdi>{p.email}</bdi> },
                            { icon: BuildingsIcon, text: companyOf(p) },
                            { icon: IdentificationBadgeIcon, text: roleWord(p.role) },
                            ...(p.signInLockedUntil || p.ownPasswordPausedUntil ? [{ icon: LockIcon, text: lock(p) }] : []),
                        ]}
                        foot={points(p)}
                    />
                )}
                footer={<Pager page={page} pageCount={listed.totalPages} onPage={setPage} summary={countOf(t, locale, listed.total, 'employees')} />}
            />
        )
    }

    return (
        <Page>
            <PageHeader
                title={t('all_users')}
                subtitle={t('all_users_hint')}
                action={<ButtonLink href="/dashboard/super-admins" icon={ShieldCheckIcon}>{t('super_admins')}</ButtonLink>}
            />
            <TabLinks label={t('all_users_tabs')} items={[
                { href: pathname, label: t('all_users_tab_current'), current: !left },
                { href: `${pathname}?show=left`, label: t('all_users_tab_left'), current: left },
            ]} />
            <FilterBar
                search={<Field label={t('all_users_search')} hideLabel>{p => (
                    <SearchInput {...p} name="search" autoComplete="off" placeholder={t('all_users_search')} value={typed} onChange={e => setTyped(e.target.value)} />
                )}</Field>}
                activeCount={companyId ? 1 : 0}
                onReset={typed || companyId ? () => { setTyped(''); setCompanyId('') } : undefined}
            >
                <Field label={t('company_label')} hideLabel>{p => (
                    <Select {...p} icon={BuildingsIcon} name="companyId" value={companyId} onChange={e => setCompanyId(e.target.value)}
                        options={[{ value: '', label: t('all_users_any_company') }, ...companies.map(c => ({ value: c.id, label: c.name }))]} />
                )}</Field>
            </FilterBar>
            {list}

            {removing && (
                <DeleteTemplateDialog
                    name={emailOf(removing)}
                    body={t('all_users_delete_body')}
                    busy={busy}
                    onCancel={() => setRemoving(null)}
                    onConfirm={() => { void remove(removing) }}
                />
            )}
        </Page>
    )
}
