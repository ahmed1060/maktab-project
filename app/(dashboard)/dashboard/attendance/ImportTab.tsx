'use client'

import { useRef, useState } from 'react'
import useSWR from 'swr'
import { DownloadSimpleIcon, HourglassIcon, TrayIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, ButtonDownload, Card, Details, Dialog, DialogActions, EmptyState, Field, FileChip, FilePicker, Row, Select, StatusBadge, TextArea } from '@/components/ui'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import type { TranslationKey } from '@/lib/translations'
import { useBusyAction } from '@/lib/useBusyAction'
import { send, json } from './send'
import { useFigures } from './period'

/**
 * Importing a terminal's spreadsheet (ATTENDANCE_PLAN.md Phase 0): checked
 * first, so nothing is saved until the person importing has seen what the
 * file holds, then imported. A file sent twice is stored once, and a whole
 * wrong file is withdrawn, never edited.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, Attendance part 6, PR 152):
 * the file, how its dates are written and which column is which in one
 * card, with what the file holds before Import; the files imported as rows;
 * and withdrawing one in the building blocks' dialog, which asks why.
 *
 * With no terminal, a file can start from the template (ATTENDANCE_PLAN.md
 * §13.9, PR 272): Download template under the file picker, in the page's
 * language, which goes once a file is picked (DESIGN.md §5.5, Files).
 */

export type Columns = { code: number; date: number; time: number | null; direction: number | null }
export type Report = {
    fileName: string; headers: string[]; columns: Columns | null
    rowCount: number; ready: number; duplicates: number; locked: number
    problems: { row: number; code: string | null; error: string }[]; problemCount: number
    codes: { code: string; userId: string | null; name: string | null; rows: number }[]
    from: string | null; to: string | null; importId?: string; added?: number
}
type ImportRow = { id: string; fileName: string; createdAt: string; rowCount: number; addedCount: number; duplicateCount: number; refusedCount: number; voidedAt: string | null; voidReason: string | null }
type DateOrder = 'DMY' | 'MDY'

const PROBLEM_KEYS: Record<string, TranslationKey> = {
    NO_CODE: 'punch_problem_NO_CODE', NO_DATE: 'punch_problem_NO_DATE', BAD_DATE: 'punch_problem_BAD_DATE',
    NO_TIME: 'punch_problem_NO_TIME', BAD_TIME: 'punch_problem_BAD_TIME',
}

export default function ImportTab({ q, companyId }: { q: string; companyId: string | null }) {
    const { t, locale } = useLanguage()
    const { num, date } = useFigures()
    const { showToast } = useToast()
    const [file, setFile] = useState<File | null>(null)
    const [dateOrder, setDateOrder] = useState<DateOrder>('DMY')
    const [columns, setColumns] = useState<Report['columns']>(null)
    // The report on screen, with the exact file and settings it was made from:
    // importing sends those, never whatever the controls hold now (review on #12).
    const [report, setReport] = useState<(Report & { made: { file: File; dateOrder: DateOrder; columns: Report['columns'] } }) | null>(null)
    const [busy, setBusy] = useState(false)
    const [withdrawing, setWithdrawing] = useState<ImportRow | null>(null)
    const [reason, setReason] = useState('')
    const [reasonError, setReasonError] = useState<string | undefined>()
    const action = useBusyAction()
    const { data: history, error: historyError, isValidating, mutate } = useSWR(`/api/attendance/imports?${q}`, fetcher)
    const imports: ImportRow[] | null = history ? history.data?.imports ?? [] : null
    // Bumped by every change of file or settings and by every request, so a
    // reply to an older request is dropped rather than shown over a newer one.
    const generation = useRef(0)
    const invalidate = () => { generation.current += 1; setReport(null) }

    const run = async (commit: boolean, chosen: Report['columns'] = columns) => {
        const made = commit && report ? report.made : file ? { file, dateOrder, columns: chosen } : null
        if (!made) return
        const mine = ++generation.current
        setBusy(true)
        try {
            const form = new FormData()
            form.append('file', made.file)
            form.append('dateOrder', made.dateOrder)
            if (companyId) form.append('companyId', companyId)
            if (made.columns) form.append('columns', JSON.stringify(made.columns))
            if (commit) form.append('commit', 'true')
            const r = await send('/api/attendance/imports', { method: 'POST', body: form }, t('punch_failed'))
            if (mine !== generation.current) return
            if (!r.ok) return showToast(r.error, 'error')
            if (commit) {
                showToast(t('punch_imported').replace('{n}', num(r.body.added ?? 0)), 'success')
                setFile(null); setReport(null); setColumns(null)
                void mutate()
            } else {
                setReport({ ...r.body, made: { ...made, columns: r.body.columns } })
                setColumns(r.body.columns)
            }
        } finally { if (mine === generation.current) setBusy(false) }
    }

    const pick = (field: keyof Columns, value: string) => {
        const base = columns ?? { code: 0, date: 1, time: null, direction: null }
        const next = { ...base, [field]: value === '' ? null : Number(value) }
        setColumns(next)
        // run() starts a new generation, so a reply for the previous columns is dropped.
        void run(false, next)
    }

    const openWithdraw = (i: ImportRow) => { setReason(''); setReasonError(undefined); setWithdrawing(i) }
    // Not while it works: closing then would hide the answer.
    const closeWithdraw = () => { if (!action.running) setWithdrawing(null) }
    const withdraw = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (!withdrawing) return
        const form = e.currentTarget
        if (reason.trim().length < 3) {
            setReasonError(t('punch_reason_required'))
            requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
            return
        }
        void action.run('withdraw', async () => {
            const r = await send(`/api/attendance/imports/${withdrawing.id}/void`, json('POST', { reason: reason.trim() }), t('punch_failed'))
            // Refused, it stays open with the reason typed, to try again.
            if (!r.ok) return showToast(r.error, 'error')
            showToast(t('punch_import_withdrawn'), 'success')
            setWithdrawing(null)
            await mutate()
        })
    }

    const toImport = report ? Math.max(0, report.ready - report.duplicates) : 0
    const counts = (i: ImportRow) => t('punch_import_counts').replace('{added}', num(i.addedCount)).replace('{dup}', num(i.duplicateCount)).replace('{refused}', num(i.refusedCount))

    return (
        <>
            {/* Checked first, then imported: nothing is saved until Import. */}
            <Card title={t('punch_tab_import')}>
                <p className="ui-card-note">{t('punch_import_hint')}</p>
                {file
                    ? <FileChip name={file.name} size={file.size} onRemove={busy ? undefined : () => { setFile(null); setColumns(null); invalidate() }} />
                    : (
                        <>
                            <FilePicker label={t('punch_choose_file')} hint={t('punch_file_hint')} accept=".xlsx,.csv,.txt" multiple={false} disabled={busy}
                                onFiles={files => { setFile(files[0] ?? null); setColumns(null); invalidate() }} />
                            <div>
                                <ButtonDownload variant="quiet" size="sm" icon={DownloadSimpleIcon} href={`/api/attendance/import-template?${q}locale=${locale}`}>
                                    {t('download_template')}
                                </ButtonDownload>
                            </div>
                        </>
                    )}
                <div className="ui-field-row">
                    <Field label={t('punch_date_order')}>{f => (
                        <Select {...f} value={dateOrder} disabled={busy} onChange={e => { setDateOrder(e.target.value as DateOrder); invalidate() }}
                            options={[{ value: 'DMY', label: t('punch_date_order_dmy') }, { value: 'MDY', label: t('punch_date_order_mdy') }]} />
                    )}</Field>
                </div>
                {report && <ImportReportView report={report} onPick={pick} busy={busy} />}
                <div className="ui-card-actions">
                    <Button disabled={!file || busy} busy={busy && !report} onClick={() => { void run(false) }}>{t('punch_check_file')}</Button>
                    {report && (
                        <Button variant="primary" disabled={busy || toImport <= 0} busy={busy && !!report} onClick={() => { void run(true) }}>
                            {t('punch_import_n').replace('{n}', num(toImport))}
                        </Button>
                    )}
                </div>
            </Card>

            <Card title={t('punch_import_history')}>
                {historyError ? (
                    <EmptyState icon={WarningCircleIcon} title={t('punch_imports_load_failed')} detail={(historyError as SWRError).info?.error}
                        action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                ) : imports === null ? (
                    <div role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
                ) : imports.length === 0 ? (
                    <EmptyState icon={TrayIcon} title={t('punch_no_imports')} />
                ) : (
                    // Straight in the card, as on Public holidays: a panel in it was a box in a box (found in the interface audit, PR 152).
                    <ul className="ui-rows" aria-label={t('punch_import_history')}>
                        {imports.map(i => (
                            <Row key={i.id}
                                title={<bdi>{i.fileName}</bdi>}
                                detail={i.voidedAt
                                    ? t('punch_import_withdrawn_because').replace('{date}', date(i.createdAt.slice(0, 10))).replace('{reason}', i.voidReason ?? '')
                                    : t('punch_import_detail').replace('{date}', date(i.createdAt.slice(0, 10))).replace('{counts}', counts(i))}
                                end={i.voidedAt
                                    ? <StatusBadge tone="neutral">{t('punch_badge_WITHDRAWN')}</StatusBadge>
                                    : <Button size="sm" onClick={() => openWithdraw(i)}>{t('punch_withdraw_import')}</Button>} />
                        ))}
                    </ul>
                )}
            </Card>

            {/* Withdrawing a whole file asks why: its punches stay on record, with the reason. */}
            <Dialog open={withdrawing !== null} onClose={closeWithdraw} title={t('punch_withdraw_import')}>
                {withdrawing && (
                    <form className="ui-form" noValidate onSubmit={withdraw}>
                        <Details items={[
                            { label: t('punch_file'), value: <bdi>{withdrawing.fileName}</bdi> },
                            { label: t('punch_import_on'), value: date(withdrawing.createdAt.slice(0, 10)) },
                            { label: t('punch_import_added'), value: num(withdrawing.addedCount) },
                        ]} />
                        <p>{t('punch_withdraw_import_hint')}</p>
                        <Field label={t('punch_reason')} error={reasonError}>{f => (
                            <TextArea {...f} name="reason" value={reason} disabled={action.running}
                                onChange={e => { setReason(e.target.value); setReasonError(undefined) }} />
                        )}</Field>
                        <DialogActions>
                            <Button onClick={closeWithdraw} disabled={action.running}>{t('cancel')}</Button>
                            <Button variant="danger" type="submit" disabled={action.running} busy={action.is('withdraw')}>
                                {t('punch_withdraw_import')}
                            </Button>
                        </DialogActions>
                    </form>
                )}
            </Dialog>
        </>
    )
}

/**
 * What a file holds, before it's imported: which column is which, each a
 * select, and what importing it would do, a line each, those to look at in
 * their colour (DESIGN.md §2.3). The rows that couldn't be read are behind
 * a disclosure.
 */
export function ImportReportView({ report, onPick, busy }: { report: Report; onPick: (field: keyof Columns, value: string) => void; busy: boolean }) {
    const { t } = useLanguage()
    const { num, date } = useFigures()
    const columnSelect = (field: keyof Columns, labelKey: TranslationKey, optional: boolean) => (
        <Field label={t(labelKey)}>{f => (
            <Select {...f} value={report.columns?.[field] === null || report.columns?.[field] === undefined ? '' : String(report.columns[field])} disabled={busy}
                onChange={e => onPick(field, e.target.value)}
                options={[
                    ...(optional || !report.columns ? [{ value: '', label: optional ? t('punch_column_none') : t('punch_column_choose') }] : []),
                    ...report.headers.map((h, i) => ({ value: String(i), label: h || `#${num(i + 1)}` })),
                ]} />
        )}</Field>
    )
    const unmatched = report.codes.filter(c => !c.userId)

    return (
        <>
            {!report.columns && <p className="ui-card-note" role="status">{t('punch_columns_not_found')}</p>}
            <div className="ui-field-row">
                {columnSelect('code', 'punch_column_code', false)}
                {columnSelect('date', 'punch_column_date', false)}
                {columnSelect('time', 'punch_column_time', true)}
                {columnSelect('direction', 'punch_column_direction', true)}
            </div>
            {report.columns && (
                <ul className="ui-report" aria-label={t('punch_report_title')}>
                    <li>{t('punch_report_rows').replace('{n}', num(report.rowCount)).replace('{from}', report.from ? date(report.from) : '—').replace('{to}', report.to ? date(report.to) : '—')}</li>
                    <li>{t('punch_report_new').replace('{n}', num(report.ready - report.duplicates))}</li>
                    {report.duplicates > 0 && <li>{t('punch_report_duplicates').replace('{n}', num(report.duplicates))}</li>}
                    {report.locked > 0 && <li data-tone="waiting">{t('punch_report_locked').replace('{n}', num(report.locked))}</li>}
                    {report.problemCount > 0 && <li data-tone="problem">{t('punch_report_problems').replace('{n}', num(report.problemCount))}</li>}
                    {unmatched.length > 0 && <li data-tone="waiting">{t('punch_report_unmatched').replace('{codes}', unmatched.map(c => c.code).join(t('list_separator')))}</li>}
                </ul>
            )}
            {report.problems.length > 0 && (
                <details className="ui-more">
                    <summary>{t('punch_report_show_problems')}</summary>
                    <ul className="ui-report">
                        {report.problems.map(x => (
                            <li key={x.row}>{t('punch_problem_row').replace('{row}', num(x.row))}: {t(PROBLEM_KEYS[x.error] ?? 'punch_failed')}</li>
                        ))}
                    </ul>
                </details>
            )}
        </>
    )
}
