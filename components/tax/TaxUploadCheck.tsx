'use client'

import { useState, type ReactNode } from 'react'
import { FileXlsIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import DatePickerSingle from '@/components/DatePickerSingle'
import { Button, Icon, StatusBadge, TotalTiles } from '@/components/ui'
import { formatDay } from '@/components/records/types'
import { countOf } from '@/lib/plural'
import type { TranslationKey } from '@/lib/translations'
import type { ClaimDraft, TaxMistake } from '@/lib/tax-file'
import type { TaxChange, TaxCheck, TaxRowProblem } from '@/lib/tax-check'
import TaxExportLink from './TaxExportLink'

/** A group with this many claims or fewer is open to start with. */
const OPEN_UP_TO = 10
/** What changed of a claim, by the name its column has on the client's page. */
const WHAT = { original: 'tax_col_original', paid: 'tax_paid', remaining: 'tax_col_remaining', due: 'tax_col_due' } as const

/** Claims under a title that opens and closes them. */
function Group({ title, hint, count, children }: { title: string; hint?: string; count: number; children: ReactNode }) {
    const [open, setOpen] = useState(count <= OPEN_UP_TO)
    return (
        <details className="ui-tax-group" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
            <summary>{title}</summary>
            {hint && <p className="ui-hint">{hint}</p>}
            <ul className="ui-tax-claims">{children}</ul>
        </details>
    )
}

/**
 * What the tax portal's file would do to a client's claims, before anything
 * is saved (CLIENT_PORTAL_PLAN.md §4.1; DESIGN.md §5.5, Uploading the tax
 * portal's file): the file, the company it names, the day its figures are
 * from, what's new, changed and going, and the rows left out.
 *
 * A row with a problem stops the save, as saving the rest would delete its
 * claim: then it says only which rows, and why. Nothing is edited here, as
 * the file is the portal's. The note ends with How to get the portal's file
 * (§10, step 4c, PR 320): a file from an older copy of the export button is
 * refused this way, and that page has the new one.
 */
export default function TaxUploadCheck({ fileName, rows, check, asOf, today, busy = false, onAsOf, onAnother }: {
    fileName: string
    /** How many rows the file has, the ones left out too. */
    rows: number
    check: TaxCheck
    /** The day the figures are from, and the latest it can be. */
    asOf: string
    today: string
    /** While it's sent, or another file is read. */
    busy?: boolean
    onAsOf: (day: string) => void
    onAnother: () => void
}) {
    const { t, locale } = useLanguage()
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const num = (n: number) => n.toLocaleString(intl)
    const money = (n: number) => `${n.toLocaleString(intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`
    const counted = (key: TranslationKey, count: number) => t(key).replace('{count}', num(count))
    // As it's typed into the portal: Latin digits, left to right.
    const number = (claimNumber: string) => <bdi dir="ltr" className="ui-num">{claimNumber}</bdi>

    const file = (
        <div className="ui-tax-file">
            <Icon icon={FileXlsIcon} size={24} />
            <div>
                {/* Its own direction inside, the page's side outside: an Arabic name on an English page stays at the start. */}
                <span className="ui-tax-file-name"><bdi>{fileName}</bdi></span>
                <span className="ui-hint">{t('tax_upload_file_rows').replace('{rows}', countOf(t, locale, rows, 'rows'))}</span>
            </div>
            <Button size="sm" disabled={busy} onClick={onAnother}>{t('tax_upload_another_file')}</Button>
        </div>
    )

    if (check.problems.length > 0) {
        const rowName = (problem: TaxRowProblem) => {
            if (!problem.claimNumber) return t('tax_upload_row').replace('{line}', num(problem.line))
            const [before, after = ''] = t('tax_upload_row_claim').replace('{line}', num(problem.line)).split('{number}')
            return <>{before}{number(problem.claimNumber)}{after}</>
        }
        // What the file had is kept apart from the sentence, whichever way each reads, and put in as it
        // was: a `$` in it is the file's, not a pattern of the sentence's.
        const mistakeWords = (mistake: TaxMistake) => {
            const said = t(`tax_mistake_${mistake.code}` as TranslationKey)
            if (mistake.code === 'number_twice') return said.replace('{line}', num(Number(mistake.detail)))
            return said.replace('{had}', () => `⁨${mistake.detail ?? ''}⁩`)
        }
        return (
            <div className="ui-tax-check">
                {file}
                <div className="ui-dialog-note" data-tone="problem" role="alert">
                    <p>{counted('tax_upload_problems', check.problems.length)}</p>
                    <p><TaxExportLink newTab /></p>
                </div>
                <ul className="ui-tax-problems">
                    {check.problems.map(problem => (
                        <li key={problem.line}>
                            <strong>{rowName(problem)}</strong>
                            <ul className="ui-row-mistakes">
                                {problem.mistakes.map((mistake, i) => <li key={i}><Icon icon={WarningCircleIcon} size={16} />{mistakeWords(mistake)}</li>)}
                            </ul>
                        </li>
                    ))}
                </ul>
            </div>
        )
    }

    const changeWords = (change: TaxChange) => change.what === 'details'
        ? t('tax_upload_details_changed')
        : t('tax_upload_was_now').replace('{what}', t(WHAT[change.what]))
            .replace('{before}', change.what === 'due' ? formatDay(change.before, locale) : money(change.before))
            .replace('{after}', change.what === 'due' ? formatDay(change.after, locale) : money(change.after))
    // A claim: its number, its item and what remains, with what's said of it under them.
    const claimLine = (claim: ClaimDraft, under?: ReactNode) => (
        <li key={claim.claimNumber}>
            <span className="ui-tax-claim">{number(claim.claimNumber)} <bdi>{claim.item}</bdi> <strong className="ui-nowrap ui-num">{money(claim.remainingAmount)}</strong></span>
            {under}
        </li>
    )

    return (
        <div className="ui-tax-check">
            {file}
            <p className="ui-tax-company">
                <span className="ui-hint">{t('tax_upload_company')}</span>
                {check.company && <bdi>{check.company}</bdi>}
                <StatusBadge tone={check.namesClient ? 'good' : 'waiting'}>
                    {t(check.namesClient ? 'tax_upload_this_client' : check.company ? 'tax_upload_other_name' : 'tax_upload_no_company')}
                </StatusBadge>
            </p>
            <div className="ui-tax-asof">
                <DatePickerSingle
                    name="asOf"
                    label={t('tax_upload_as_of')}
                    value={asOf}
                    onChange={onAsOf}
                    maxDate={today}
                    disabled={busy}
                    hint={t('tax_upload_as_of_hint')}
                    error={asOf ? undefined : t('tax_upload_as_of_missing')}
                />
            </div>
            <TotalTiles items={[
                { label: t('tax_upload_in_file'), value: num(check.claims.length) },
                { label: t('tax_upload_new'), value: num(check.added.length) },
                { label: t('tax_upload_changed'), value: num(check.changed.length) },
                { label: t('tax_upload_same'), value: num(check.same) },
                { label: t('tax_upload_going'), value: num(check.gone.length) },
            ]} />
            <p className="ui-tax-owed">{t('tax_upload_owed').replace('{now}', money(check.owedNow)).replace('{after}', money(check.owedAfter))}</p>
            {check.gone.length > 0 && (
                <Group title={counted('tax_upload_going_title', check.gone.length)} hint={t('tax_upload_going_hint')} count={check.gone.length}>
                    {check.gone.map(claim => claimLine(claim))}
                </Group>
            )}
            {check.changed.length > 0 && (
                <Group title={counted('tax_upload_changed_title', check.changed.length)} count={check.changed.length}>
                    {check.changed.map(({ after, changes }) => claimLine(after, <span className="ui-hint">{changes.map(changeWords).join(t('list_separator'))}</span>))}
                </Group>
            )}
            {check.added.length > 0 && (
                <Group title={counted('tax_upload_new_title', check.added.length)} count={check.added.length}>
                    {check.added.map(claim => claimLine(claim))}
                </Group>
            )}
            {check.paid > 0 && <p className="ui-hint">{counted('tax_upload_left_paid', check.paid)}</p>}
            {check.otherStatuses.map(other => {
                const [before, after = ''] = counted('tax_upload_left_status', other.rows).split('{status}')
                return <p key={other.status} className="ui-hint">{before}<bdi>{other.status}</bdi>{after}</p>
            })}
        </div>
    )
}
