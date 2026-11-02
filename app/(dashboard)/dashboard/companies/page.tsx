'use client'

import { useEffect, useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { usePathname, useSearchParams } from 'next/navigation'
import {
    BuildingsIcon, CalendarBlankIcon, CheckCircleIcon, CreditCardIcon, GearSixIcon, HourglassIcon, MagnifyingGlassIcon,
    PackageIcon, PencilSimpleIcon, PlusIcon, ProhibitIcon, TrashIcon, WarningCircleIcon,
} from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import { refusalOf } from '@/components/CompanyRolesCard'
import { BanCompanyDialog, CompanyDialog } from '@/components/CompanyDialogs'
import DeleteTemplateDialog from '@/components/DeleteTemplateDialog'
import { SubscriptionBadge, SubscriptionDates } from '@/components/SubscriptionBadge'
import {
    Button, ButtonLink, DataList, EmptyState, Field, FilterBar, ItemTitle, ListCard, Page, PageHeader, Pager, RowMenu,
    SearchInput, Select, StatusBadge, TabLinks, pageInRange, type Column, type MenuItem,
} from '@/components/ui'
import { useCompany } from '@/context/CompanyContext'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import type { SubscriptionState } from '@/lib/billing/state'
import { countOf } from '@/lib/plural'
import { bundleLabelKeys } from '@/lib/subscription-display'
import { SWRError } from '@/lib/swr-fetcher'
import { forScope, loadFailed, scopedFetcher, scopedKey } from '@/lib/swr-scoped'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useViewer } from '@/lib/useCan'

/**
 * The Companies (the Super Admin's pages part 3a, UI_PLAN.md §5 step 5): a
 * list, a table on computers and cards on phones, of each company's
 * subscription and package. It opens on the ones that need attention, the
 * only question worth asking on a Monday morning; All companies is the other
 * tab, kept in the address (`?show=all`). Each company's settings, payments,
 * Edit, Ban and Delete are in its menu.
 */
type Company = {
    id: string
    name: string
    isBanned?: boolean
    package?: { id: string; name: string; hasCompanyManagement: boolean; hasHR: boolean; hasAttendanceTerminals?: boolean; hasAttendanceMobile?: boolean } | null
    hasUnpaidPayment?: boolean
    subscription?: { state: SubscriptionState; date: string | null; daysRemaining: number | null }
}
type Listed = { data: Company[]; total: number; totalPages: number; totalCompanies: number; needsAttentionCount: number }
type Sort = 'date' | 'name'
const LIMIT = 10

export default function CompaniesPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { triggerRefresh } = useCompany()
    // Who is looking comes from the layout on the first paint, so a Super
    // Admin never sees "Access restricted" while the session loads.
    const viewer = useViewer()
    const isSuperAdmin = viewer?.role === 'SUPER_ADMIN'
    const params = useSearchParams()
    const pathname = usePathname()
    const all = params.get('show') === 'all'

    const [sort, setSort] = useState<Sort>('date')
    // Asked of the server a moment after the typing stops, not per letter.
    const [typed, setTyped] = useState('')
    const [search, setSearch] = useState('')
    useEffect(() => {
        const id = setTimeout(() => setSearch(typed.trim()), 250)
        return () => clearTimeout(id)
    }, [typed])
    // Another tab, sort or search starts from its first page: page 3 of a
    // list that just became four rows long would show nothing.
    const [page, setPage] = useState(1)
    const scope = `${all}/${sort}/${search}`
    const [scopeShown, setScopeShown] = useState(scope)
    if (scope !== scopeShown) {
        setScopeShown(scope)
        setPage(1)
    }

    const [editing, setEditing] = useState<Company | 'new' | null>(null)
    const [banning, setBanning] = useState<Company | null>(null)
    const [removing, setRemoving] = useState<Company | null>(null)
    const [busy, setBusy] = useState(false)

    // The rows stay up while the next page, tab or search loads, each
    // answer tagged with what it was asked for: when one fails, the list says
    // so, rather than leave the last one's rows under the new search (Codex
    // on PR 171). A failed refresh of the rows on screen leaves them up.
    const listUrl = isSuperAdmin ? `/api/companies?page=${page}&limit=${LIMIT}&filter=${all ? 'all' : 'needs-attention'}&sort=${sort}&search=${encodeURIComponent(search)}` : null
    const { data, error, isValidating, mutate } = useSWR(scopedKey(listUrl, ''), scopedFetcher, { keepPreviousData: true })
    const failed = loadFailed(data, error, listUrl)
    const listed: Listed | null = failed ? null : forScope(data, '')?.data ?? null
    // Fewer pages than the one shown, as when a rename takes the last company
    // on a page out of the search, or the last is deleted: the last page
    // there is now (Codex on PR 171). An empty page shows no pager to leave it by.
    const pageCount = listed?.totalPages
    useAdjustOnChange([pageCount], () => { if (pageCount !== undefined) setPage(p => pageInRange(p, pageCount)) })

    if (!isSuperAdmin) return <AccessDenied />

    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const tab = (label: string, count: number | undefined) => <>{label}{count !== undefined && <>{' '}<span className="ui-tab-count">{num(count)}</span></>}</>
    const said = (key: Parameters<typeof t>[0], name: string) => t(key).replace('{name}', name)

    const act = async (run: () => Promise<Response>, done: string, after?: () => void) => {
        setBusy(true)
        try {
            const res = await run()
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            showToast(done, 'success')
            after?.()
            await mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }
    const ban = (c: Company) => act(
        () => fetch('/api/companies', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, isBanned: !c.isBanned }) }),
        said(c.isBanned ? 'companies_unbanned_done' : 'companies_banned_done', c.name),
        () => setBanning(null),
    )
    // The server asks for a recent authenticator code first (lib/step-up.ts),
    // and the code prompt asks for it and sends this again.
    const remove = (c: Company) => act(
        () => fetch(`/api/companies?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' }),
        said('companies_deleted', c.name),
        () => {
            setRemoving(null)
            triggerRefresh()
        },
    )

    const menu = (c: Company) => {
        const items: MenuItem[] = [
            // Goes there and nothing else: it doesn't change the company in
            // view in the top bar, as Payments doesn't.
            { key: 'settings', label: t('company_settings_title'), icon: GearSixIcon, href: `/dashboard/companies/${c.id}/settings` },
            { key: 'payments', label: t('companies_payments'), icon: CreditCardIcon, href: `/dashboard/companies/${c.id}/payments` },
            { key: 'edit', label: t('edit'), icon: PencilSimpleIcon, onSelect: () => setEditing(c) },
            { key: 'ban', label: t(c.isBanned ? 'companies_unban' : 'companies_ban'), icon: c.isBanned ? CheckCircleIcon : ProhibitIcon, danger: !c.isBanned || undefined, onSelect: () => setBanning(c) },
            { key: 'delete', label: t('delete'), icon: TrashIcon, danger: true, onSelect: () => setRemoving(c) },
        ]
        return <RowMenu label={t('ui_more_actions_for').replace('{name}', c.name)} tooltip={t('ui_more_actions')} items={items} />
    }
    const banned = (c: Company) => c.isBanned && <>{' '}<StatusBadge tone="problem">{t('companies_banned')}</StatusBadge></>
    // What its package grants, in words: who is on Company Management alone and could be sold HR.
    const grants = (c: Company) => {
        if (!c.package) return null
        const keys = bundleLabelKeys(c.package)
        return keys.length === 0 ? t('core_only') : keys.map(k => t(k)).join(t('list_separator'))
    }
    const packageName = (c: Company) => c.package ? <bdi>{c.package.name}</bdi> : t('no_package')
    const dated = (c: Company) => !!c.subscription && (!!c.subscription.date || c.subscription.state === 'LIFETIME')

    const columns: Column<Company>[] = [
        { key: 'name', header: t('companies_name'), cell: c => <ItemTitle title={<><bdi>{c.name}</bdi>{banned(c)}</>} /> },
        {
            key: 'subscription', header: t('subscription_state'), cell: c => c.subscription && (
                <>
                    {/* Its badges lead the line, so not the title's, which sets a badge in from a name (found in the browser). */}
                    <div className="ui-badge-line">
                        <SubscriptionBadge subscription={c.subscription} />
                        {c.hasUnpaidPayment && <StatusBadge tone="waiting">{t('unpaid_record')}</StatusBadge>}
                    </div>
                    {dated(c) && <div className="ui-item-detail"><SubscriptionDates subscription={c.subscription} /></div>}
                </>
            ),
        },
        { key: 'package', header: t('package_label'), cell: c => <ItemTitle title={packageName(c)} detail={grants(c)} /> },
        { key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end', cell: menu },
    ]

    const empty = search
        ? <EmptyState icon={MagnifyingGlassIcon} title={t('companies_none_match')} />
        : !all
            ? <EmptyState icon={CheckCircleIcon} title={t('nothing_needs_attention')} action={<ButtonLink href={`${pathname}?show=all`}>{t('companies_show_all')}</ButtonLink>} />
            : <EmptyState icon={BuildingsIcon} title={t('companies_none')} />

    let list: ReactNode
    if (!listed) {
        list = failed ? (
            <div className="ui-panel">
                <EmptyState icon={WarningCircleIcon} title={t('companies_load_failed')} detail={(error as SWRError).info?.error}
                    action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
            </div>
        ) : (
            <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        )
    } else {
        list = (
            <DataList
                caption={t('companies')}
                columns={columns}
                rows={listed.data}
                rowKey={c => c.id}
                empty={empty}
                card={c => (
                    // Banned beside the name, as in the table; the package and
                    // what it grants one piece, so the line's gap doesn't fall
                    // before the comma (found in the browser).
                    <ListCard
                        title={<><bdi>{c.name}</bdi>{banned(c)}</>}
                        status={c.subscription && <SubscriptionBadge subscription={c.subscription} />}
                        details={[
                            ...(c.subscription && dated(c) ? [{ icon: CalendarBlankIcon, text: <SubscriptionDates subscription={c.subscription} /> }] : []),
                            { icon: PackageIcon, text: <span>{packageName(c)}{grants(c) && <>{t('list_separator')}{grants(c)}</>}</span> },
                        ]}
                        foot={<><span>{c.hasUnpaidPayment && <StatusBadge tone="waiting">{t('unpaid_record')}</StatusBadge>}</span>{menu(c)}</>}
                    />
                )}
                footer={<Pager page={page} pageCount={listed.totalPages} onPage={setPage} summary={countOf(t, locale, listed.total, 'companies')} />}
            />
        )
    }

    return (
        <Page>
            <PageHeader
                title={t('companies')}
                subtitle={t('companies_hint')}
                action={<Button variant="primary" icon={PlusIcon} onClick={() => setEditing('new')}>{t('companies_add')}</Button>}
            />
            <TabLinks label={t('companies_tabs')} items={[
                { href: pathname, label: tab(t('needs_attention_filter'), listed?.needsAttentionCount), current: !all },
                { href: `${pathname}?show=all`, label: tab(t('companies_tab_all'), listed?.totalCompanies), current: all },
            ]} />
            <FilterBar
                search={<Field label={t('companies_search')} hideLabel>{p => (
                    <SearchInput {...p} name="search" autoComplete="off" placeholder={t('companies_search')} value={typed} onChange={e => setTyped(e.target.value)} />
                )}</Field>}
                activeCount={sort === 'date' ? 0 : 1}
                onReset={typed || sort !== 'date' ? () => { setTyped(''); setSort('date') } : undefined}
            >
                <Field label={t('companies_sort')} hideLabel>{p => (
                    <Select {...p} name="sort" value={sort} onChange={e => setSort(e.target.value as Sort)}
                        options={[{ value: 'date', label: t('companies_sort_date') }, { value: 'name', label: t('companies_sort_name') }]} />
                )}</Field>
            </FilterBar>
            {list}

            {editing && (
                <CompanyDialog
                    company={editing === 'new' ? null : editing}
                    onClose={() => setEditing(null)}
                    onChanged={() => { triggerRefresh(); void mutate() }}
                    onSaved={(name, added) => {
                        setEditing(null)
                        showToast(said(added ? 'companies_added' : 'companies_saved', name), 'success')
                        triggerRefresh()
                        void mutate()
                    }}
                />
            )}
            {banning && <BanCompanyDialog company={banning} busy={busy} onCancel={() => setBanning(null)} onConfirm={() => { void ban(banning) }} />}
            {removing && (
                <DeleteTemplateDialog
                    name={removing.name}
                    body={t('companies_delete_body')}
                    busy={busy}
                    onCancel={() => setRemoving(null)}
                    onConfirm={() => { void remove(removing) }}
                />
            )}
        </Page>
    )
}
