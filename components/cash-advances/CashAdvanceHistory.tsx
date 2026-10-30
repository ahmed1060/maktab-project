'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import {
    ArrowUDownLeftIcon, CalendarBlankIcon, CheckCircleIcon, ClipboardTextIcon, HandCoinsIcon, HourglassIcon, NotePencilIcon, PaperclipIcon, SlidersHorizontalIcon, UserIcon,
    WalletIcon, WarningCircleIcon,
} from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import ConfirmModal from '@/components/ConfirmModal'
import {
    Button, DataList, EmptyState, FileChip, ItemTitle, ListCard, Page, PageHeader, Pager, pageInRange, StatusBadge, TotalTiles, type Column,
} from '@/components/ui'
import { fetcher } from '@/lib/swr-fetcher'
import { countOf } from '@/lib/plural'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { dayLabel, refusalText, type EntryKind, type RecordedKind } from '@/lib/cash-advances'
import type { TranslationKey } from '@/lib/translations'
import CashAdvanceDialog from './CashAdvanceDialog'
import type { AdvanceEntry } from './types'

const LIMIT = 20

const KIND_LABEL: Record<EntryKind, TranslationKey> = {
    GIVEN: 'advances_kind_given', SPENT: 'advances_kind_spent', RETURNED: 'advances_kind_returned', CORRECTION: 'advances_kind_correction',
}

type Advance = {
    /** Today where the company is. */
    today: string
    person: { id: string; name: string; atWork: boolean }
    balance: number
    awaiting: number
    data: AdvanceEntry[]
    total: number
    totalPages: number
    canGive: boolean
}

/**
 * One person's cash advance (CLIENTS_PLAN.md §7.5): their balance, what's
 * awaiting their confirmation, and every entry, newest first, with who
 * recorded it. On My cash advance, their own, with Confirm receipt on each
 * advance given them (§7.3). For whoever gives and settles advances, Give
 * advance, Record return and Correction.
 */
export default function CashAdvanceHistory({ userId, mine = false }: { userId: string; mine?: boolean }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const [page, setPage] = useState(1)
    const [recording, setRecording] = useState<RecordedKind | null>(null)
    const [confirming, setConfirming] = useState<AdvanceEntry | null>(null)

    const url = `/api/cash-advances/${encodeURIComponent(userId)}?page=${page}&limit=${LIMIT}`
    const { data, error, isLoading, isValidating, mutate } = useSWR<{ data: Advance }>(url, fetcher, { keepPreviousData: true })
    const advance = data?.data
    const code = (error as { info?: { code?: string }; status?: number } | undefined)
    useAdjustOnChange([advance?.totalPages ?? 0], () => setPage(p => pageInRange(p, advance?.totalPages ?? 0)))

    const money = (n: number) => `${n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`
    const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`
    const back = mine ? undefined : { href: '/dashboard/costs?tab=advances', label: t('costs_tab_advances') }
    const title = mine ? t('my_cash_advance') : advance ? <bdi>{advance.person.name}</bdi> : t('costs_tab_advances')

    /** Confirm receipt: "I received 1,000.00 EGP" (§7.3). */
    const confirm = async () => {
        const entry = confirming
        if (!entry) return
        try {
            const res = await fetch(`/api/cash-advances/entries/${encodeURIComponent(entry.id)}/confirm`, { method: 'POST' })
            const answer = await res.json().catch(() => null)
            if (!res.ok) showToast(refusalText(t, answer), 'error')
            else showToast(t('advances_confirmed_done'), 'success')
            void mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setConfirming(null)
        }
    }

    if (!advance) {
        const off = code?.info?.code === 'CASH_ADVANCES_OFF'
        return (
            <Page>
                <PageHeader title={title} back={back} />
                <div className="ui-panel" role={isLoading ? 'status' : undefined}>
                    {isLoading || (!error && !data)
                        ? <EmptyState icon={HourglassIcon} title={t('advances_loading')} />
                        : off ? <EmptyState icon={WalletIcon} title={t('advances_off')} />
                            : code?.status === 404 ? <EmptyState icon={UserIcon} title={t('advances_person_not_found')} />
                                : <EmptyState icon={WarningCircleIcon} title={t('advances_load_failed')} action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />}
                </div>
            </Page>
        )
    }

    const awaitingOf = (e: AdvanceEntry) => e.kind === 'GIVEN' && !e.confirmedAt
    const status = (e: AdvanceEntry) => e.kind !== 'GIVEN' ? null
        : e.confirmedAt ? <StatusBadge tone="good">{t('advances_confirmed')}</StatusBadge>
            : <StatusBadge tone="waiting">{t('advances_awaiting')}</StatusBadge>
    // Spent on a cost, or put back as it was removed; on its task, while it's there (§7.4).
    const kindOf = (e: AdvanceEntry) => t(e.kind === 'SPENT' && e.amount > 0 ? 'advances_kind_put_back' : KIND_LABEL[e.kind])
    const onTask = (e: AdvanceEntry) => e.kind !== 'SPENT' ? null
        : e.task ? <Link href={`/dashboard/tasks/${encodeURIComponent(e.task.id)}`} prefetch={false} className="ui-item-link"><bdi>{e.task.title}</bdi></Link>
            : <span>{t('advances_task_gone')}</span>
    const what = (e: AdvanceEntry) => (
        <>
            <ItemTitle title={kindOf(e)} detail={onTask(e) ?? (e.note ? <bdi>{e.note}</bdi> : undefined)} detailIcon={onTask(e) ? ClipboardTextIcon : e.note ? NotePencilIcon : undefined} />
            {e.photoUrl && <FileChip name={t('advances_photo')} href={e.photoUrl} />}
        </>
    )
    const by = (e: AdvanceEntry) => e.recordedByName ? <bdi>{e.recordedByName}</bdi> : t('unknown_user')
    const confirmButton = (e: AdvanceEntry) => mine && awaitingOf(e) && (
        <Button size="sm" icon={CheckCircleIcon} onClick={() => setConfirming(e)}>{t('advances_confirm_receipt')}</Button>
    )

    const columns: Column<AdvanceEntry>[] = [
        { key: 'date', header: t('advances_col_date'), cell: e => <span className="ui-nowrap">{dayLabel(e.date, locale)}</span> },
        { key: 'what', header: t('advances_col_what'), cell: what },
        { key: 'amount', header: t('advances_amount'), align: 'end', cell: e => <strong className="ui-nowrap ui-num">{signed(e.amount)}</strong> },
        { key: 'by', header: t('advances_col_by'), cell: by },
        { key: 'status', header: t('advances_col_status'), cell: e => <>{status(e)}{confirmButton(e) && <div>{confirmButton(e)}</div>}</> },
    ]

    const giving = advance.canGive && (
        <>
            {advance.person.atWork && <Button variant="primary" icon={HandCoinsIcon} onClick={() => setRecording('GIVEN')}>{t('advances_give')}</Button>}
            {advance.balance > 0 && <Button icon={ArrowUDownLeftIcon} onClick={() => setRecording('RETURNED')}>{t('advances_record_return')}</Button>}
            <Button icon={SlidersHorizontalIcon} onClick={() => setRecording('CORRECTION')}>{t('advances_correct')}</Button>
        </>
    )

    return (
        <Page>
            <PageHeader
                title={title}
                subtitle={mine ? t('my_cash_advance_subtitle') : !advance.person.atWork ? t('advances_not_at_work_badge') : undefined}
                back={back}
                action={giving || undefined}
            />
            <TotalTiles items={[
                { label: t(mine ? 'advances_your_balance' : 'advances_col_balance'), value: money(advance.balance) },
                { label: t('advances_col_awaiting'), value: money(advance.awaiting), note: mine && advance.awaiting > 0 ? t('advances_awaiting_note') : undefined },
            ]} />
            <DataList
                caption={t('advances_history')}
                columns={columns}
                rows={advance.data}
                rowKey={e => e.id}
                card={e => (
                    <ListCard
                        title={kindOf(e)}
                        status={status(e)}
                        details={[
                            { icon: WalletIcon, text: <strong className="ui-num">{signed(e.amount)}</strong> },
                            ...(onTask(e) ? [{ icon: ClipboardTextIcon, text: onTask(e) }] : []),
                            { icon: CalendarBlankIcon, text: <span>{dayLabel(e.date, locale)}</span> },
                            ...(e.note ? [{ icon: NotePencilIcon, text: <bdi>{e.note}</bdi> }] : []),
                            { icon: UserIcon, text: <span>{t('advances_recorded_by').replace('{name}', e.recordedByName ?? t('unknown_user'))}</span> },
                            ...(e.photoUrl ? [{ icon: PaperclipIcon, text: <FileChip name={t('advances_photo')} href={e.photoUrl} /> }] : []),
                        ]}
                        foot={confirmButton(e) || undefined}
                    />
                )}
                footer={<Pager page={page} pageCount={advance.totalPages} onPage={setPage} summary={countOf(t, locale, advance.total, 'entries')} />}
                empty={<EmptyState icon={WalletIcon} title={t(mine ? 'advances_mine_none' : 'advances_person_none')} />}
            />

            <CashAdvanceDialog
                person={recording ? { id: advance.person.id, name: advance.person.name, balance: advance.balance } : null}
                kind={recording ?? 'GIVEN'}
                today={advance.today}
                onClose={() => setRecording(null)}
                onSaved={() => { void mutate() }}
            />
            <ConfirmModal
                isOpen={!!confirming}
                title={t('advances_confirm_receipt')}
                message={t('advances_confirm_question').replace('{amount}', confirming ? money(confirming.amount) : '').replace('{date}', confirming ? dayLabel(confirming.date, locale) : '')}
                confirmText={t('advances_confirm_button').replace('{amount}', confirming ? money(confirming.amount) : '')}
                cancelText={t('cancel')}
                onConfirm={confirm}
                onCancel={() => setConfirming(null)}
            />
        </Page>
    )
}
