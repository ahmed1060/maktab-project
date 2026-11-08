'use client'

import useSWR from 'swr'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FileXIcon, HourglassIcon, PrinterIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import DateRangePicker from '@/components/DateRangePicker'
import { Button, EmptyState, Page, PageHeader } from '@/components/ui'
import { StatementSheet } from '@/components/charges/ClientStatement'
import { dayIso } from '@/lib/calendar-text'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useModules } from '@/lib/useModules'
import { STATEMENT_MAX_CHARGES, type Statement } from '@/lib/client-statement'

// A statement, with the address it was fetched for: SWR keeps the last one
// while another loads, and only this address's is shown as its statement.
// With the period cleared, the one for the dates before was taken for last
// month's, printable, and stayed in place of last month's refusal where
// that had too many charges (Codex on PR 227).
const fetchStatement = (key: string) => fetcher(key).then((body: { data: Statement }) => ({ key, statement: body.data }))

/**
 * A client's statement (CLIENTS_PLAN.md §6.9; DESIGN.md §5.5, Client
 * statement), opened from Statement on its Charges: its charges for a
 * period, with the receipts, to print or save as a PDF.
 *
 * Above the sheet, so none of it is printed: Print in the page header, and
 * the period, With receipts and a hint that the print dialog saves a PDF.
 * The period and the tick are in the address, so the statement opens again
 * as it was. Without a period there, the server's is last month, where the
 * company is. One that isn't theirs, or isn't there, says so; one with more
 * charges than a statement holds asks for a shorter period; one that didn't
 * load says that, with Try again.
 */
export default function ClientStatementPage() {
    const { t, locale } = useLanguage()
    const modules = useModules()
    const { id } = useParams<{ id: string }>()
    const params = useSearchParams()
    const router = useRouter()
    const pathname = usePathname()
    const from = params.get('from') ?? ''
    const to = params.get('to') ?? ''
    const withReceipts = params.get('receipts') !== '0'

    // The period asked for, in order, if both are days: else the server's.
    const asked = dayIso(from) === from && dayIso(to) === to ? (from <= to ? { from, to } : { from: to, to: from }) : null
    const query = new URLSearchParams({ clientId: id })
    if (asked) { query.set('from', asked.from); query.set('to', asked.to) }
    const key = `/api/charges/statement?${query}`
    const { data, error, isLoading, isValidating, mutate } = useSWR(key, fetchStatement, { keepPreviousData: true })
    // This address's; another's, kept while it loads, is never shown as it.
    const statement = data?.key === key ? data.statement : null
    // The client's name meanwhile, from whichever of its statements is here.
    const known = data?.statement.client.id === id ? data.statement : null
    const failure = error as SWRError | undefined
    const code = failure?.info?.code
    const missing = failure?.status === 403 || failure?.status === 404

    const go = (change: (q: URLSearchParams) => void) => {
        const next = new URLSearchParams(params.toString())
        change(next)
        const q = next.toString()
        router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
    }
    const pickPeriod = (start: string, end: string) => go(q => {
        if (start && end) { q.set('from', start); q.set('to', end) } else { q.delete('from'); q.delete('to') }
    })

    const name = known?.client.name
    const header = (
        <PageHeader
            title={t('statement_title')}
            subtitle={name && <bdi>{name}</bdi>}
            back={{ href: `/dashboard/clients/${encodeURIComponent(id)}`, label: name ? <bdi>{name}</bdi> : modules.label('clients') }}
            action={statement && <Button variant="primary" icon={PrinterIcon} onClick={() => window.print()}>{t('doc_print')}</Button>}
        />
    )
    const controls = (
        <div className="ui-doc-controls">
            <DateRangePicker hideLabel label={t('doc_period')} dateFrom={asked?.from ?? statement?.period.from ?? ''} dateTo={asked?.to ?? statement?.period.to ?? ''} onChange={pickPeriod} />
            <label className="ui-choice">
                <input type="checkbox" className="ui-check" checked={withReceipts} onChange={e => go(q => { if (e.target.checked) q.delete('receipts'); else q.set('receipts', '0') })} />
                {t('statement_with_receipts')}
            </label>
            <p className="ui-hint ui-doc-controls-hint">{t('statement_pdf_hint')}</p>
        </div>
    )

    if (statement) {
        return (
            <Page>
                {header}
                {controls}
                <div aria-busy={isValidating || undefined}>
                    <StatementSheet statement={statement} withReceipts={withReceipts} />
                </div>
            </Page>
        )
    }
    // More charges than a statement holds: a shorter period, from the period above.
    if (error && code === 'STATEMENT_TOO_MANY') {
        return (
            <Page>
                {header}
                {controls}
                <div className="ui-panel">
                    <EmptyState icon={WarningCircleIcon} title={t('statement_too_many').replace('{max}', STATEMENT_MAX_CHARGES.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB'))} />
                </div>
            </Page>
        )
    }
    if (error && !isValidating) {
        return (
            <Page>
                {header}
                <div className="ui-panel">
                    {missing
                        ? <EmptyState icon={FileXIcon} title={t('doc_not_found')} />
                        : <EmptyState icon={WarningCircleIcon} title={t('doc_load_failed')} detail={failure?.info?.error}
                            action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />}
                </div>
            </Page>
        )
    }
    // While it loads, the row above the sheet is there already, so nothing moves when it comes.
    return (
        <Page>
            {header}
            {controls}
            <div className="ui-panel" role="status" aria-busy={isLoading || undefined}><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        </Page>
    )
}
