'use client'

import { useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { DownloadSimpleIcon, HourglassIcon, IdentificationCardIcon, MagnifyingGlassIcon, ShieldIcon, UsersIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import { Button, DataList, EmptyState, Field, FilterBar, ItemTitle, ListCard, Page, PageHeader, SearchInput, type Column } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { BUILT_IN_LABEL } from '@/lib/role-label'
import { countOf } from '@/lib/plural'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import { fileName, matches, nameOf, sheetRows, type Person } from '@/lib/usernames-list'

/**
 * Each person's username, as the tasks upload's Excel file names who does
 * a task; Create task links here (UI_PLAN.md §5 step 5, the pages left).
 * On the building blocks: the page header with the download as a labelled
 * button, where it was two emoji; a search by name or username; the list,
 * and a card for each on a phone, where they were cards of its own making
 * with each side chosen by hand; and a failure to load said with Try again,
 * where it read "No employees found".
 */
export default function UsernamesPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { can } = useCan()
    // People are theirs who may see them (the list asks it); anybody else
    // is told so, where the page asked and said it had failed.
    const may = can('employees.view')
    const { data, error, isValidating, mutate } = useSWR<{ data: { data: Person[] } }>(may ? '/api/users?limit=1000' : null, fetcher)
    const [query, setQuery] = useState('')
    const [exporting, setExporting] = useState(false)

    if (!may) return <AccessDenied />

    const people = data?.data?.data
    const roleWord = (role: string) => {
        const key = BUILT_IN_LABEL[role as keyof typeof BUILT_IN_LABEL]
        return key ? t(key) : role
    }
    const username = (p: Person): ReactNode => p.username
        ? <bdi translate="no">{p.username}</bdi>
        : <span className="ui-hint">{t('usernames_none')}</span>

    // Everyone the page lists, whatever the search shows. exceljs is heavy,
    // so it's loaded only when the file is asked for (F-20).
    const download = async () => {
        if (!people?.length) return
        setExporting(true)
        try {
            const { Workbook } = await import('exceljs')
            const workbook = new Workbook()
            const sheet = workbook.addWorksheet(t('usernames'), locale === 'ar' ? { views: [{ rightToLeft: true }] } : undefined)
            sheet.columns = [
                { header: t('name_label'), key: 'name', width: 30 },
                { header: t('role_label'), key: 'role', width: 20 },
                { header: t('username_label'), key: 'username', width: 25 },
            ]
            sheet.addRows(sheetRows(people, roleWord))
            // exceljs writes files only in Node; in the browser it's built in memory and handed over.
            const buffer = await workbook.xlsx.writeBuffer()
            const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
            const link = document.createElement('a')
            link.href = url
            link.download = fileName(t('usernames'), new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone)
            document.body.appendChild(link)
            link.click()
            link.remove()
            URL.revokeObjectURL(url)
        } catch {
            showToast(t('usernames_export_failed'), 'error')
        } finally {
            setExporting(false)
        }
    }

    const columns: Column<Person>[] = [
        { key: 'name', header: t('name_label'), cell: p => <ItemTitle title={<bdi>{nameOf(p)}</bdi>} /> },
        { key: 'role', header: t('role_label'), cell: p => roleWord(p.role) },
        { key: 'username', header: t('username_label'), cell: username },
    ]
    const shown = (people ?? []).filter(p => matches(p, query))

    let list: ReactNode
    if (!people) {
        list = error ? (
            <div className="ui-panel">
                <EmptyState icon={WarningCircleIcon} title={t('usernames_load_failed')}
                    action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
            </div>
        ) : (
            <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        )
    } else {
        list = (
            <DataList
                caption={t('usernames')}
                columns={columns}
                rows={shown}
                rowKey={p => p.id}
                card={p => (
                    <ListCard title={<bdi>{nameOf(p)}</bdi>}
                        details={[{ icon: IdentificationCardIcon, text: username(p) }, { icon: ShieldIcon, text: roleWord(p.role) }]} />
                )}
                empty={people.length === 0
                    ? <EmptyState icon={UsersIcon} title={t('usernames_empty')} />
                    : <EmptyState icon={MagnifyingGlassIcon} title={t('usernames_no_match').replace('{query}', query.trim())}
                        // The button goes with the search, so the focus goes back to the search.
                        action={<Button onClick={() => { setQuery(''); document.querySelector<HTMLElement>('[name="q"]')?.focus() }}>{t('clear_search')}</Button>} />}
            />
        )
    }

    return (
        <Page>
            <PageHeader title={t('usernames')} subtitle={t('usernames_subtitle')}
                action={<Button icon={DownloadSimpleIcon} busy={exporting} disabled={!people?.length} onClick={() => { void download() }}>{t('download_excel')}</Button>} />
            <FilterBar search={(
                <Field label={t('usernames_search')} hideLabel>{p => (
                    <SearchInput {...p} name="q" autoComplete="off" spellCheck={false} placeholder={t('usernames_search')} value={query} onChange={e => setQuery(e.target.value)} />
                )}</Field>
            )} />
            {/* How many a search finds, said out loud, as the list changes without a word (web interface audit, PR 182). */}
            <span className="ui-visually-hidden" aria-live="polite">{query.trim() && people ? countOf(t, locale, shown.length, 'employees') : ''}</span>
            {list}
        </Page>
    )
}
