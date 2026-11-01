'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { useParams } from 'next/navigation'
import { FileXIcon, HourglassIcon, PrinterIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, Details, DocGroup, DocLine, DocNote, DocTotal, DocumentSheet, EmptyState, Page, PageHeader } from '@/components/ui'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'

/**
 * One final settlement statement, to print or send again by email.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, Documents part 2, PR 155;
 * DESIGN.md §5.5, Document): the page header with Send by email beside
 * Print, above the sheet so neither is on the paper, and who owes whom said
 * in words, with its colour as a bar that prints, where the old coloured fill
 * didn't. One that isn't there, or isn't theirs to see, says so; one that
 * didn't load says that instead, with Try again.
 */

type Doc = {
    person: { name: string; email: string }
    company: { name: string; logoUrl?: string | null }
    lastWorkingDay: string
    earned: number
    paid: number
    net: number
    debtRecovered: number
    payable: number
    direction: 'COMPANY_OWES' | 'PERSON_OWES' | 'SETTLED'
    status: string
    dueDate: string
    reason?: string | null
    emailedAt?: string | null
}

export default function SettlementDocumentPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const params = useParams()
    const isRtl = locale === 'ar'

    const { data, error, isLoading, isValidating, mutate } = useSWR(`/api/settlements/${params.id}`, fetcher)
    // A failed refresh after a resend keeps the document on screen: the
    // states below are only for when there is nothing to show.
    const doc: Doc | null = data?.data ?? null
    const status = (error as SWRError | undefined)?.status
    const missing = status === 403 || status === 404
    const [sending, setSending] = useState(false)

    const resend = async () => {
        setSending(true)
        try {
            const res = await fetch(`/api/settlements/${params.id}/resend`, { method: 'POST' })
            const body = await res.json()
            showToast(res.ok ? t('doc_sent') : (body?.error || t('doc_send_failed')), res.ok ? 'success' : 'error')
            if (res.ok) void mutate()
        } catch {
            showToast(t('doc_send_failed'), 'error')
        } finally {
            setSending(false)
        }
    }

    // The sign is said in words (the verdict below), so the figure is shown without one.
    const money = (n: number) =>
        new Intl.NumberFormat(isRtl ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n))
    const date = (d: string) => new Date(d).toLocaleDateString(isRtl ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

    const header = (
        <PageHeader
            title={t('doc_settlement')}
            subtitle={doc?.person.name}
            action={doc && <>
                <Button busy={sending} onClick={resend}>{doc.emailedAt ? t('doc_send_again') : t('doc_send')}</Button>
                <Button variant="primary" icon={PrinterIcon} onClick={() => window.print()}>{t('doc_print')}</Button>
            </>}
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

    // The label is chosen from the sign, in one place, so the wording and the
    // figure cannot disagree — the one thing this document must never do. Its
    // colour is what it means for the person.
    const verdict = {
        COMPANY_OWES: { text: t('doc_company_owes'), tone: 'good' as const },
        PERSON_OWES: { text: t('doc_person_owes'), tone: 'problem' as const },
        SETTLED: { text: t('doc_settled'), tone: 'neutral' as const },
    }[doc.direction]

    return (
        <Page>
            {header}
            <DocumentSheet title={t('doc_settlement')} company={doc.company}>
                <Details items={[
                    { label: t('doc_issued_to'), value: doc.person.name },
                    { label: t('doc_last_working_day'), value: date(doc.lastWorkingDay) },
                    { label: t('doc_due'), value: date(doc.dueDate) },
                ]} />

                {/* Two sides, both shown. A statement that printed only the net would
                    be arithmetic somebody has to take on trust; printing what was
                    earned beside what had already gone out is what lets them check
                    it. */}
                <DocGroup>
                    <DocLine label={t('doc_earned')} amount={money(doc.earned)} />
                    <DocLine label={t('doc_already_paid')} amount={money(doc.paid)} minus />
                    <DocTotal label={t('doc_net')} amount={money(doc.net)} />
                </DocGroup>

                {/* I1: money the person already owed, taken out of what they are
                    owed. Below the net rather than inside it, so "earned less paid
                    is net" still reads correctly, and shown only when there is
                    something to show. */}
                {doc.debtRecovered > 0 && (
                    <DocGroup>
                        <DocLine label={t('doc_debt_recovered')} amount={money(doc.debtRecovered)} minus />
                        <DocTotal label={t('doc_payable')} amount={money(doc.payable)} />
                    </DocGroup>
                )}

                <DocNote tone={verdict.tone}>{verdict.text}</DocNote>

                {doc.reason && <DocNote tone="neutral">{t('doc_reason')}: {doc.reason}</DocNote>}
            </DocumentSheet>
        </Page>
    )
}
