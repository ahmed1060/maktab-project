'use client'

import { useCallback, type ReactNode } from 'react'
import useSWR from 'swr'
import { HourglassIcon, LightningIcon, MagnifyingGlassIcon, ScrollIcon, ShapesIcon, UserIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import DateRangePicker from '@/components/DateRangePicker'
import { useListAddress, useSearchField } from '@/components/filters/useListAddress'
import {
    Button, DataList, EmptyState, Field, FilterBar, ItemTitle, ListCard, Page, PageHeader, Pager, SearchInput, Select, StatusBadge,
    type Column, type StatusTone,
} from '@/components/ui'
import { useCompany } from '@/context/CompanyContext'
import { useLanguage } from '@/context/LanguageContext'
import { AUDIT_ACTIONS, AUDIT_ACTION_GROUPS, AUDIT_ENTITY_TYPES } from '@/lib/audit-codes'
import { describeDetails, type DetailLine } from '@/lib/audit-details'
import { countOf } from '@/lib/plural'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { forScope, loadFailed, scopedFetcher, scopedKey } from '@/lib/swr-scoped'
import type { TranslationKey } from '@/lib/translations'
import { useViewer } from '@/lib/useCan'

/**
 * The audit log (the Super Admin's pages, Operations part 2, UI_PLAN.md §5
 * step 5): every sensitive change, who made it and when, a table on
 * computers and cards on phones. Found by the item's ID or an error's code,
 * who did it, what it was on, what was done and when, each kept in the
 * address, so a link such as the dashboard's System errors lands filtered,
 * and narrowed to the company the top bar picked.
 */
type AuditLog = {
    id: string
    action: string
    entityType: string
    entityId: string
    userId: string | null
    superAdminId: string | null
    // Json on the backend (F-12), read by lib/audit-details.ts.
    details: unknown
    createdAt: string
    user?: { firstName: string; lastName: string; email: string; role: string } | null
    superAdmin?: { firstName: string; lastName: string; email: string } | null
}
type Listed = { data: AuditLog[]; total: number; page: number; totalPages: number }
type Named = { id: string; firstName: string; lastName: string; company?: { name: string } | null }
const LIMIT = 20
/** Shown before the rest of an entry's details, which wait behind Show more. */
const SHOWN = 3
/** Longer, as a stack trace or a note, waits behind Show more too. */
const SHORT = 120
const FILTERS = ['entityType', 'action', 'startDate', 'endDate', 'entityId', 'performedById'] as const

/** What was done, in its meaning's colour: a deletion a problem, a creation good. */
const toneOf = (action: string): StatusTone => action.includes('DELETE') ? 'problem' : action.includes('CREATE') ? 'good' : 'neutral'

export default function AuditLogsPage() {
    const { t, locale } = useLanguage()
    // Who is looking comes from the layout on the first paint, so a Super
    // Admin never sees "Access restricted" while the session loads.
    const viewer = useViewer()
    const isSuperAdmin = viewer?.role === 'SUPER_ADMIN'
    const { selectedCompanyId } = useCompany()

    const { picked, go } = useListAddress('/dashboard/audit-logs')
    const filters = Object.fromEntries(FILTERS.map(k => [k, picked.get(k) || ''])) as Record<typeof FILTERS[number], string>
    const page = Math.max(1, Number(picked.get('page')) || 1)
    // The ID or code, sent once typing pauses, where every letter asked again.
    const goSearch = useCallback((changes: Record<string, string>) => go({ entityId: changes.search }), [go])
    const { query, setQuery, clear } = useSearchField(filters.entityId, goSearch)

    // Whose entries: the Super Admins, whom the old list didn't offer, and
    // the people in every company.
    const { data: usersResult } = useSWR(isSuperAdmin ? '/api/users?limit=1000' : null, fetcher)
    const { data: adminsResult } = useSWR(isSuperAdmin ? '/api/super-admins?page=1&limit=100' : null, fetcher)
    const users: Named[] = usersResult?.data?.data ?? []
    const admins: Named[] = adminsResult?.data?.data ?? []

    const asked = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
    for (const k of FILTERS) if (filters[k]) asked.set(k, filters[k])
    if (selectedCompanyId) asked.set('companyId', selectedCompanyId)
    const listUrl = isSuperAdmin ? `/api/admin/audit-logs?${asked.toString()}` : null
    // The rows stay up while the next page loads, each answer tagged with
    // what it was asked for; not across filters or companies, where they'd
    // be drawn under a choice they aren't for.
    const scope = [...FILTERS.map(k => filters[k]), selectedCompanyId ?? ''].join('/')
    const { data, error, isValidating, mutate } = useSWR(scopedKey(listUrl, scope), scopedFetcher, { keepPreviousData: true })
    const failed = loadFailed(data, error, listUrl)
    const listed: Listed | null = failed ? null : forScope(data, scope)?.data ?? null

    if (!isSuperAdmin) return <AccessDenied />

    const dateLocale = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const label = (prefix: 'audit_action_' | 'audit_entity_', code: string) => t(`${prefix}${code}` as TranslationKey) || code
    // Every labelled action and item (lib/audit-codes.ts), alphabetical in the reader's language.
    const sorted = (prefix: 'audit_action_' | 'audit_entity_', codes: readonly string[]) =>
        codes.map(code => ({ value: code, label: label(prefix, code) })).sort((a, b) => a.label.localeCompare(b.label, locale))
    const nameOf = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim()
    const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, locale)

    const filtersOn = (filters.performedById ? 1 : 0) + (filters.entityType ? 1 : 0) + (filters.action ? 1 : 0) + (filters.startDate || filters.endDate ? 1 : 0)
    const resetFilters = () => {
        clear()
        go(Object.fromEntries(FILTERS.map(k => [k, ''])))
    }

    const when = (log: AuditLog) => <span className="ui-nowrap">{new Intl.DateTimeFormat(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(log.createdAt))}</span>
    const action = (log: AuditLog) => <StatusBadge tone={toneOf(log.action)}>{label('audit_action_', log.action)}</StatusBadge>
    // Its ID, as the code wrote it: left to right, never translated.
    const itemId = (log: AuditLog) => <bdi dir="ltr" translate="no">{log.entityId}</bdi>
    // A Super Admin, a person in a company and their role, or the system's own jobs.
    const by = (log: AuditLog) => log.superAdmin ? { name: nameOf(log.superAdmin), as: t('role_super_admin') }
        : log.user ? { name: nameOf(log.user), as: t(`audit_value_${log.user.role}` as TranslationKey) || log.user.role }
            : { name: t('audit_by_system'), as: t('audit_by_automated') }
    // What changed, in the reader's words (lib/audit-details.ts); the stored details aren't changed.
    const lines = (items: DetailLine[]): ReactNode => (
        <ul className="ui-report">
            {items.map((line, i) => (
                <li key={i}>
                    {line.label && <span className="ui-hint">{line.label}{line.lines ? '' : ': '}</span>}
                    {line.value !== undefined && <span className="ui-report-value">{line.value}</span>}
                    {line.lines && lines(line.lines)}
                </li>
            ))}
        </ul>
    )
    // The first few, and the rest, such as an error's stack trace, behind Show more.
    const details = (log: AuditLog): ReactNode => {
        const all = describeDetails(log.details, { t, locale })
        if (all.length === 0) return null
        // The first few short ones, in the order they're kept; Postgres keeps
        // shorter names first, so an error's stack trace came before its
        // message (found in the browser). A long line or a field's own
        // fields waits behind Show more with the rest.
        const short = (line: DetailLine) => !line.lines && (line.value ?? '').length <= SHORT && !(line.value ?? '').includes('\n')
        const shown = all.filter(short).slice(0, SHOWN)
        // Behind it, the shorter first: an error's message before its stack trace (found in the browser).
        const size = (line: DetailLine) => line.value?.length ?? 0
        const rest = all.filter(line => !shown.includes(line)).sort((a, b) => size(a) - size(b))
        // A block of its own, the card's full width on a phone.
        return (
            <div className="ui-report-block">
                {shown.length > 0 && lines(shown)}
                {rest.length > 0 && (
                    <details className="ui-more">
                        <summary>{t('audit_more').replace('{n}', rest.length.toLocaleString(dateLocale))}</summary>
                        {lines(rest)}
                    </details>
                )}
            </div>
        )
    }

    const columns: Column<AuditLog>[] = [
        { key: 'when', header: t('audit_when'), cell: when },
        { key: 'action', header: t('audit_what'), cell: action },
        { key: 'item', header: t('audit_item'), cell: log => <ItemTitle title={label('audit_entity_', log.entityType)} detail={itemId(log)} /> },
        // A name on one line, where "Super Admin" broke onto two (found in the browser).
        { key: 'by', header: t('audit_by'), cell: log => <ItemTitle title={<span className="ui-nowrap">{by(log).name}</span>} detail={by(log).as} /> },
        { key: 'details', header: t('details'), cell: details },
    ]

    // An ID or a code is found whole: said where none matches (the interface audit).
    const empty = filtersOn > 0 || filters.entityId
        ? <EmptyState icon={MagnifyingGlassIcon} title={t('audit_none_match')} detail={filters.entityId ? t('audit_search_whole') : undefined} />
        : <EmptyState icon={ScrollIcon} title={t('audit_none')} />

    let list: ReactNode
    if (!listed) {
        list = failed ? (
            <div className="ui-panel">
                <EmptyState icon={WarningCircleIcon} title={t('audit_load_failed')} detail={(error as SWRError).info?.error}
                    action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
            </div>
        ) : (
            <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        )
    } else {
        list = (
            <DataList
                caption={t('audit_logs')}
                columns={columns}
                rows={listed.data}
                rowKey={log => log.id}
                empty={empty}
                card={log => (
                    <ListCard
                        title={label('audit_action_', log.action)}
                        details={[
                            { icon: ShapesIcon, text: <>{label('audit_entity_', log.entityType)}{t('list_separator')}{itemId(log)}</> },
                            { icon: UserIcon, text: `${by(log).name}${t('list_separator')}${by(log).as}` },
                            { icon: LightningIcon, text: when(log) },
                        ]}
                        foot={details(log)}
                    />
                )}
                footer={<Pager page={page} pageCount={listed.totalPages} onPage={p => go({ page: String(p) })} summary={countOf(t, locale, listed.total, 'logged')} />}
            />
        )
    }

    return (
        <Page>
            <PageHeader title={t('audit_logs')} subtitle={t('audit_logs_subtitle')} />
            <FilterBar
                search={<Field label={t('audit_search')} hideLabel>{p => (
                    <SearchInput {...p} name="entityId" autoComplete="off" spellCheck={false} placeholder={t('audit_search')} value={query} onChange={e => setQuery(e.target.value)} />
                )}</Field>}
                activeCount={filtersOn}
                onReset={filtersOn > 0 || query ? resetFilters : undefined}
            >
                <Field label={t('audit_by')} hideLabel>{p => (
                    <Select {...p} icon={UserIcon} name="performedById" value={filters.performedById} onChange={e => go({ performedById: e.target.value })}
                        options={[{ value: '', label: t('audit_by_anyone') }]}
                        groups={[
                            { label: t('super_admins'), options: admins.map(a => ({ value: a.id, label: nameOf(a) })).sort(byName) },
                            { label: t('audit_by_people'), options: users.map(u => ({ value: u.id, label: u.company ? `${nameOf(u)} (${u.company.name})` : nameOf(u) })).sort(byName) },
                        ]} />
                )}</Field>
                <Field label={t('audit_item')} hideLabel>{p => (
                    <Select {...p} icon={ShapesIcon} name="entityType" value={filters.entityType} onChange={e => go({ entityType: e.target.value })}
                        options={[{ value: '', label: t('audit_any_item') }, ...sorted('audit_entity_', AUDIT_ENTITY_TYPES)]} />
                )}</Field>
                <Field label={t('audit_what')} hideLabel>{p => (
                    <Select {...p} icon={LightningIcon} name="action" value={filters.action} onChange={e => go({ action: e.target.value })}
                        options={[{ value: '', label: t('audit_any_action') }]}
                        groups={[
                            // Every action of a kind, whose code starts with it (AuditLogService.getMany).
                            { label: t('audit_kinds'), options: AUDIT_ACTION_GROUPS.map(g => ({ value: g, label: label('audit_action_', g) })) },
                            { label: t('audit_actions'), options: sorted('audit_action_', AUDIT_ACTIONS) },
                        ]} />
                )}</Field>
                <DateRangePicker asField hideLabel dateFrom={filters.startDate} dateTo={filters.endDate} onChange={(startDate, endDate) => go({ startDate, endDate })} />
            </FilterBar>
            {list}
        </Page>
    )
}
