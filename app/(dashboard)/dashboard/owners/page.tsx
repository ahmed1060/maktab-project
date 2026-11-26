'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import {
    CalendarBlankIcon, CrownIcon, EnvelopeSimpleIcon, HourglassIcon, LockIcon, PencilSimpleIcon, UserMinusIcon, WarningCircleIcon,
} from '@phosphor-icons/react/ssr'
import { useCompany } from '@/context/CompanyContext'
import { useLanguage } from '@/context/LanguageContext'
import AccessDenied from '@/components/AccessDenied'
import { SignInLock } from '@/components/SignInLock'
import { OwnerDialog } from '@/components/profile/OwnerDialog'
import {
    Avatar, Button, ButtonLink, DataList, EmptyState, Field, FilterBar, ItemTitle, ListCard, Page, PageHeader, Pager, pageInRange,
    SearchInput, StatusBadge, type Column,
} from '@/components/ui'
import { forScope, loadFailed, scopedFetcher, scopedKey } from '@/lib/swr-scoped'
import { useCan, useViewer } from '@/lib/useCan'
import { countOf } from '@/lib/plural'
import { STATUS_TONE, STATUS_WORD } from '@/lib/person-status'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useLiveOnline } from '@/components/LiveUpdates'
import { onlineTopics } from '@/lib/live-updates'
import { personName, type PersonNames } from '@/lib/names'
import { monthLabel } from '@/lib/owners'
import { editsProfile } from '@/lib/profile-access'
import { employeesListUrl } from '../employees/list-query'

/**
 * The company's owners (LATER_CHANGES_PLAN.md §7.3, step 3c, PR 429): beside
 * Employees, whose list they leave, in its look (DESIGN.md §5.5, The Owners
 * list). Since when each is one and their status; Edit and Remove from
 * owners, nothing about pay or points, as an owner has neither. An Admin is
 * added to the owners from their details, where the dialog checks for work
 * still open, so this page has no button for it.
 */

interface Owner {
    id: string
    firstName: string
    lastName: string
    firstNameAr?: string | null
    lastNameAr?: string | null
    email: string
    role: string
    status: string
    // For who comes and goes in each company, as on Employees (part 6b).
    company?: { id: string; name: string } | null
    /** Since which month they're one, 'YYYY-MM'. */
    ownerSince: string | null
    /** Their company's month now, 'YYYY-MM', for the dialog that takes them off. */
    thisMonth: string | null
    signInLockedUntil?: string | null
    ownPasswordPausedUntil?: string | null
}

export default function OwnersPage() {
    const { t, locale } = useLanguage()
    const viewer = useViewer()
    const userRole = viewer?.role || ''
    const isSuperAdmin = userRole === 'SUPER_ADMIN'
    const { can, companyWide } = useCan()
    const { selectedCompanyId } = useCompany()
    // A team has no Admins, and only an Admin is an owner: for whoever sees the whole company's people.
    const opens = !!viewer && companyWide('employees.view')

    const [page, setPage] = useState(1)
    const limit = 10
    const [query, setQuery] = useState('')
    const [search, setSearch] = useState('')
    const [removing, setRemoving] = useState<{ id: string; name: string; thisMonth: string } | null>(null)

    // The search is sent once typing pauses, not on every key.
    useEffect(() => {
        if (query.trim() === search) return
        const timer = setTimeout(() => { setSearch(query.trim()); setPage(1) }, 400)
        return () => clearTimeout(timer)
    }, [query, search])

    const listUrl = opens ? employeesListUrl({
        page, limit,
        companyId: selectedCompanyId,
        teamOnly: false,
        search,
        sort: 'name', order: 'asc',
        lang: locale,
        owners: 'only',
    }) : null
    const { data: scoped, error, isValidating, mutate } = useSWR(scopedKey(listUrl, selectedCompanyId), scopedFetcher, { keepPreviousData: true })
    const result = forScope(scoped, selectedCompanyId)
    const failed = loadFailed(scoped, error, listUrl)
    const owners: Owner[] = failed ? [] : result?.data?.data || []
    const totalPages: number = result?.data?.totalPages || 0
    const total: number = result?.data?.total || 0
    // Their badge as they come and go, in place, as on Employees (REALTIME_PLAN.md part 6b).
    useLiveOnline(viewer && opens ? onlineTopics(viewer, selectedCompanyId, owners.map(e => e.company?.id)) : [], () => { void mutate() }, result?.data?.onlineRunsOutInMs)

    useAdjustOnChange([selectedCompanyId], () => setPage(1))
    useAdjustOnChange([totalPages], () => setPage(p => pageInRange(p, totalPages)))

    // Once it's known who's looking, so nobody sees "access denied" on the way in.
    if (viewer && !companyWide('employees.view')) return <AccessDenied />

    const nameOf = (e: PersonNames) => personName(e, locale)
    const own = (e: Owner) => e.id === viewer?.id
    // As on their details: an Admin's edited by the Super Admin alone, and
    // taken off the owners by an Admin or the Super Admin (PR 428).
    const canEdit = (e: Owner) => !own(e) && editsProfile({ can, viewer, person: e })
    const canRemove = (e: Owner) => !own(e) && can('employees.set_owner') && (isSuperAdmin || userRole === 'ADMIN')
    const actsOnOwners = isSuperAdmin || can('employees.edit') || (can('employees.set_owner') && userRole === 'ADMIN')

    const actions = (e: Owner) => {
        const month = e.thisMonth
        return (
            <span className="ui-row-actions">
                {/* Each named for its person, so a list of them isn't heard as the same button again and again. */}
                {canEdit(e) && <ButtonLink href={`/dashboard/employees/${e.id}`} size="sm" icon={PencilSimpleIcon} prefetch={false} aria-label={t('owners_edit_named').replace('{name}', nameOf(e))}>{t('edit')}</ButtonLink>}
                {canRemove(e) && month && (
                    <Button size="sm" icon={UserMinusIcon} aria-label={t('owners_remove_named').replace('{name}', nameOf(e))} onClick={() => setRemoving({ id: e.id, name: nameOf(e), thisMonth: month })}>{t('owner_remove')}</Button>
                )}
            </span>
        )
    }

    const name = (e: Owner) => <Link href={`/dashboard/employees/${e.id}?mode=view`} prefetch={false} className="ui-item-link">{nameOf(e)}</Link>
    const since = (e: Owner) => e.ownerSince ? monthLabel(e.ownerSince, locale) : null
    const statusBadge = (e: Owner) => <StatusBadge tone={STATUS_TONE[e.status] ?? 'neutral'}>{STATUS_WORD[e.status] ? t(STATUS_WORD[e.status]) : e.status}</StatusBadge>
    // Locked out of signing in, with Unlock, under the status, as on Employees.
    const lock = (e: Owner) => <SignInLock personId={e.id} name={nameOf(e)} until={e.signInLockedUntil} paused={e.ownPasswordPausedUntil} onUnlocked={() => { void mutate() }} />

    const columns: Column<Owner>[] = [
        {
            key: 'name', header: t('name_label'), cell: e => (
                <div className="ui-person">
                    <Avatar name={nameOf(e)} />
                    <div><ItemTitle title={name(e)} detail={<bdi>{e.email}</bdi>} /></div>
                </div>
            ),
        },
        { key: 'since', header: t('owners_since_column'), cell: since },
        { key: 'status', header: t('status_label'), cell: e => <>{statusBadge(e)}{lock(e)}</> },
        ...(actsOnOwners ? [{ key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end' as const, cell: actions }] : []),
    ]

    const resetSearch = () => { setQuery(''); setSearch(''); setPage(1) }

    return (
        <Page>
            <PageHeader title={t('owners_title')} subtitle={t('owners_subtitle')} />

            <FilterBar
                search={<Field label={t('employees_search')} hideLabel>{p => <SearchInput {...p} autoComplete="off" placeholder={t('employees_search')} value={query} onChange={e => setQuery(e.target.value)} />}</Field>}
                onReset={query ? resetSearch : undefined}
            />

            {!result && !failed
                ? <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
                : (
                    <DataList
                        caption={t('owners_title')}
                        columns={columns}
                        rows={owners}
                        rowKey={e => e.id}
                        card={e => (
                            <ListCard
                                title={name(e)}
                                status={statusBadge(e)}
                                details={[
                                    { icon: EnvelopeSimpleIcon, text: <bdi>{e.email}</bdi> },
                                    ...(e.ownerSince ? [{ icon: CalendarBlankIcon, text: `${t('owners_since_column')}: ${since(e)}` }] : []),
                                    ...(e.signInLockedUntil || e.ownPasswordPausedUntil ? [{ icon: LockIcon, text: lock(e) }] : []),
                                ]}
                                foot={<><span />{actsOnOwners && actions(e)}</>}
                            />
                        )}
                        footer={<Pager page={page} pageCount={totalPages} onPage={setPage} summary={countOf(t, locale, total, 'owners')} />}
                        empty={failed
                            ? <EmptyState icon={WarningCircleIcon} title={t('owners_load_failed')} action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                            : search
                                ? <EmptyState icon={CrownIcon} title={t('owners_none_found')} action={<Button variant="quiet" onClick={resetSearch}>{t('ui_reset_filters')}</Button>} />
                                : <EmptyState icon={CrownIcon} title={t('owners_none')} detail={t('owners_none_body')} />}
                    />
                )}

            {removing && (
                <OwnerDialog
                    userId={removing.id}
                    name={removing.name}
                    owner={true}
                    month={removing.thisMonth}
                    onClose={() => setRemoving(null)}
                    onDone={() => { setRemoving(null); void mutate() }}
                />
            )}
        </Page>
    )
}
