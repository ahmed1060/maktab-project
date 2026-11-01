'use client'
import useSWR from 'swr'
import { useParams } from 'next/navigation'
import { FileXIcon, HourglassIcon, PrinterIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, Details, DocGroup, DocLine, DocNote, DocTotal, DocumentSheet, EmptyState, Page, PageHeader } from '@/components/ui'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'

/**
 * One payslip, to read and to print.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, Documents part 2, PR 155;
 * DESIGN.md §5.5, Document): the page header with Print above the sheet, so
 * Print is never on the paper, and the sheet in the page's language, digits
 * too. One that isn't there, or isn't theirs, says so; one that didn't load
 * says that instead, with Try again. Saying "doesn't exist" for a failed load
 * sent people to ask HR about a payslip that was there all along.
 */

type Doc = {
    person: { name: string; email: string }
    company: { name: string; logoUrl?: string | null }
    period: { month: number; year: number }
    status: 'DRAFT' | 'APPROVED' | 'PAID'
    daysPaid: number
    excluded: boolean
    exclusionReason?: string | null
    earnings: number
    deductions: number
    net: number
    carried: number
    lines: { kind: 'EARNING' | 'DEDUCTION'; label: string; amount: number }[]
}

export default function PayslipDocumentPage() {
    const { t, locale } = useLanguage()
    const params = useParams()
    const digits = locale === 'ar' ? 'ar-EG' : 'en-GB'

    const { data, error, isLoading, isValidating, mutate } = useSWR(`/api/payslips/${params.id}`, fetcher)
    const doc: Doc | null = data?.data ?? null
    const status = (error as SWRError | undefined)?.status
    // Refused or missing is the answer; anything else might pass.
    const missing = status === 403 || status === 404

    const money = (n: number) =>
        new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
    // "October 2026", the year in the page's digits too.
    const period = doc ? new Date(doc.period.year, doc.period.month - 1).toLocaleString(digits, { month: 'long', year: 'numeric' }) : undefined

    const header = (
        <PageHeader
            title={t('doc_payslip')}
            subtitle={period}
            action={doc && <Button variant="primary" icon={PrinterIcon} onClick={() => window.print()}>{t('doc_print')}</Button>}
        />
    )

    if (!doc) {
        if (isLoading) return <Page>{header}<div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div></Page>
        return (
            <Page>
                {header}
                <div className="ui-panel">
                    {missing || !error
                        ? <EmptyState icon={FileXIcon} title={t('doc_not_found')} />
                        : <EmptyState icon={WarningCircleIcon} title={t('doc_load_failed')} detail={(error as SWRError).info?.error}
                            action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />}
                </div>
            </Page>
        )
    }

    const earnings = doc.lines.filter(l => l.kind === 'EARNING')
    const deductions = doc.lines.filter(l => l.kind === 'DEDUCTION')

    return (
        <Page>
            {header}
            <DocumentSheet title={t('doc_payslip')} company={doc.company}>
                {/* A draft says so on its face. A payslip that turns out to have been
                    provisional, without having said so, is worse than no payslip. */}
                {doc.status === 'DRAFT' && <DocNote tone="waiting">{t('doc_draft_note')}</DocNote>}

                <Details items={[
                    { label: t('doc_issued_to'), value: doc.person.name },
                    { label: t('doc_period'), value: period },
                    { label: t('doc_days_paid'), value: doc.daysPaid.toLocaleString(digits) },
                ]} />

                {doc.excluded && <DocNote tone="neutral">{t('doc_excluded_note').replace('{reason}', doc.exclusionReason || '')}</DocNote>}

                <DocGroup title={t('doc_earnings')}>
                    {earnings.map((l, i) => <DocLine key={i} label={l.label} amount={money(l.amount)} />)}
                    <DocTotal label={t('doc_earnings')} amount={money(doc.earnings)} />
                </DocGroup>

                {deductions.length > 0 && (
                    <DocGroup title={t('doc_deductions')}>
                        {deductions.map((l, i) => <DocLine key={i} label={l.label} amount={money(l.amount)} minus />)}
                        <DocTotal label={t('doc_deductions')} amount={money(doc.deductions)} minus />
                    </DocGroup>
                )}

                <DocTotal label={t('doc_net')} amount={money(doc.net)} />

                {/* The net floors at zero, so what the deductions could not take has
                    to be said somewhere or it simply disappears from the document
                    that was supposed to account for it. */}
                {doc.carried > 0 && <DocNote tone="neutral">{t('doc_carried_note').replace('{amount}', money(doc.carried))}</DocNote>}
            </DocumentSheet>
        </Page>
    )
}
