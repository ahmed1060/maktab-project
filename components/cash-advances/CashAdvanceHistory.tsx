'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import {
    ArrowUDownLeftIcon, ArrowsLeftRightIcon, CalendarBlankIcon, CheckCircleIcon, ClipboardTextIcon, HandCoinsIcon, HandshakeIcon, HourglassIcon, NotePencilIcon, PaperclipIcon, SlidersHorizontalIcon,
    UserIcon, UserSwitchIcon, WalletIcon, WarningCircleIcon,
} from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import {
    Button, Card, ConfirmDialog, DataList, Details, EmptyState, FileChip, Icon, ItemTitle, ListCard, Page, PageHeader, Pager, pageInRange, StatusBadge, TotalTiles, type Column,
} from '@/components/ui'
import { fetcher } from '@/lib/swr-fetcher'
import { countOf } from '@/lib/plural'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { dayLabel, refusalText, type EntryKind, type RecordedKind } from '@/lib/cash-advances'
import type { TranslationKey } from '@/lib/translations'
import { fill } from '@/components/attendance-calendar/fill'
import CashAdvanceDialog from './CashAdvanceDialog'
import type { AdvanceEntry, HeldFor } from './types'

const LIMIT = 20

const KIND_LABEL: Record<EntryKind, TranslationKey> = {
    GIVEN: 'advances_kind_given', SPENT: 'advances_kind_spent', RETURNED: 'advances_kind_returned', CORRECTION: 'advances_kind_correction',
    DEBT: 'advances_kind_debt', MOVED: 'advances_kind_moved', TRANSFERRED: 'advances_kind_transferred',
}

type Advance = {
    /** Today where the company is. */
    today: string
    person: { id: string; name: string; atWork: boolean }
    balance: number
    /** The running balance, and what of the rest is for each task and client (CLIENTS_PLAN.md §7.9). */
    running: number
    held: HeldFor[]
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
    const [moving, setMoving] = useState<HeldFor | null>(null)

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

    /**
     * Move to running balance (CLIENTS_PLAN.md §7.9): all of what's held for
     * a task or a client, once it's confirmed. Two-factor sign-in is asked
     * for on the way, as for any entry that moves money.
     */
    const move = async () => {
        const part = moving
        if (!part) return
        try {
            const res = await fetch(`/api/cash-advances/${encodeURIComponent(userId)}/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ forTaskId: part.forTask?.id ?? null, forClientId: part.forClient?.id ?? null }),
            })
            const answer = await res.json().catch(() => null)
            if (!res.ok) showToast(refusalText(t, answer), 'error')
            else showToast(t('advances_moved_done'), 'success')
            void mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setMoving(null)
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

    // Money passed on with a transfer, from someone taken off the task (§7.9, 7h): confirmed as an advance given.
    const passedHere = (e: AdvanceEntry) => e.kind === 'TRANSFERRED' && e.amount > 0 && !!e.counterpartName
    const awaitingOf = (e: AdvanceEntry) => (e.kind === 'GIVEN' || passedHere(e)) && !e.confirmedAt
    const status = (e: AdvanceEntry) => e.kind !== 'GIVEN' && !passedHere(e) ? null
        : e.confirmedAt ? <StatusBadge tone="good">{t('advances_confirmed')}</StatusBadge>
            : <StatusBadge tone="waiting">{t('advances_awaiting')}</StatusBadge>
    // Spent on a cost, or put back as it was removed; on its task, while it's there (§7.4).
    const kindOf = (e: AdvanceEntry) => t(e.kind === 'SPENT' && e.amount > 0 ? 'advances_kind_put_back' : KIND_LABEL[e.kind])
    const onTask = (e: AdvanceEntry) => e.kind !== 'SPENT' ? null
        : e.task ? <Link href={`/dashboard/tasks/${encodeURIComponent(e.task.id)}`} prefetch={false} className="ui-item-link"><bdi>{e.task.title}</bdi></Link>
            : <span>{t('advances_task_gone')}</span>
    // What the money was for: a task or a client, while it's there (§7.9).
    const forName = (part: { forTask: AdvanceEntry['forTask']; forClient: AdvanceEntry['forClient'] }) =>
        part.forTask ? <Link href={`/dashboard/tasks/${encodeURIComponent(part.forTask.id)}`} prefetch={false} className="ui-item-link"><bdi>{part.forTask.title}</bdi></Link>
            : part.forClient ? <bdi>{part.forClient.name}</bdi> : null
    // Not said where it's the entry's own task: a cost on the gate paid from the gate's money (§7.9).
    // A Moved entry whose task or client has since been deleted says so.
    const forPart = (e: AdvanceEntry) => e.partGone ? <span>{t('advances_for_gone')}</span>
        : forName(e) && !(e.forTask && e.task && e.forTask.id === e.task.id)
            && <span>{fill(t('advances_for_name'), { name: forName(e) })}</span>
    const forIcon = (e: AdvanceEntry) => e.forClient ? HandshakeIcon : ClipboardTextIcon
    // Passed on with a transfer: to whom, or from whom.
    const counterpart = (e: AdvanceEntry) => e.kind === 'TRANSFERRED' && e.counterpartName
        && <span>{fill(t(e.amount < 0 ? 'advances_to_name' : 'advances_from_name'), { name: <bdi>{e.counterpartName}</bdi> })}</span>
    // Whoever gives and settles their advances moves a part to the running balance; not on one's own.
    const canMove = advance.canGive && !mine
    const partName = (part: HeldFor) => part.forTask?.title ?? part.forClient?.name ?? ''
    const moveLabel = (part: HeldFor) => t('advances_move_label').replace('{amount}', money(part.amount)).replace('{name}', partName(part))
    // Its lines under what it is: its task, what it was for, its note, each with its icon.
    const lines = (e: AdvanceEntry) => [
        ...(onTask(e) ? [{ icon: ClipboardTextIcon, text: onTask(e) }] : []),
        ...(forPart(e) ? [{ icon: forIcon(e), text: forPart(e) }] : []),
        ...(counterpart(e) ? [{ icon: UserSwitchIcon, text: counterpart(e) }] : []),
        ...(e.note ? [{ icon: NotePencilIcon, text: <bdi>{e.note}</bdi> }] : []),
    ]
    const what = (e: AdvanceEntry) => {
        const [first, ...more] = lines(e)
        return (
            <>
                <ItemTitle title={kindOf(e)} detail={first?.text} detailIcon={first?.icon} />
                {more.map((line, i) => <div key={i} className="ui-item-detail"><Icon icon={line.icon} size={16} />{line.text}</div>)}
                {e.photoUrl && <FileChip name={t('advances_photo')} href={e.photoUrl} />}
            </>
        )
    }
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
                ...(advance.held.length ? [{ label: t('advances_running'), value: money(advance.running) }] : []),
                { label: t('advances_col_awaiting'), value: money(advance.awaiting), note: mine && advance.awaiting > 0 ? t('advances_awaiting_note') : undefined },
            ]} />
            {advance.held.length > 0 && (
                <Card title={t('advances_held_for')}>
                    <Details items={advance.held.map(part => ({
                        label: forName(part),
                        value: (
                            <span className="ui-detail-act">
                                <span className="ui-num">{money(part.amount)}</span>
                                {canMove && <Button size="sm" icon={ArrowsLeftRightIcon} aria-label={moveLabel(part)} onClick={() => setMoving(part)}>{t('advances_move')}</Button>}
                            </span>
                        ),
                    }))} />
                </Card>
            )}
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
                            ...(forPart(e) ? [{ icon: forIcon(e), text: forPart(e) }] : []),
                            ...(counterpart(e) ? [{ icon: UserSwitchIcon, text: counterpart(e) }] : []),
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
            {/* Saying it arrived deletes nothing: the main button, where it was the old window's red. */}
            {/* Moving keeps every pound theirs: the main button, not red. */}
            <ConfirmDialog
                open={!!moving}
                title={t('advances_move_title')}
                body={moving ? fill(t('advances_move_body'), { amount: money(moving.amount), name: <bdi>{partName(moving)}</bdi>, person: <bdi>{advance.person.name}</bdi> }) : ''}
                confirmLabel={fill(t('advances_move_button'), { amount: moving ? money(moving.amount) : '' })}
                onConfirm={move}
                onCancel={() => setMoving(null)}
            />
            <ConfirmDialog
                open={!!confirming}
                title={t('advances_confirm_receipt')}
                body={confirming?.kind === 'TRANSFERRED'
                    ? fill(t('advances_confirm_passed_question'), { amount: money(confirming.amount), name: <bdi>{confirming.counterpartName}</bdi> })
                    : t('advances_confirm_question').replace('{amount}', confirming ? money(confirming.amount) : '').replace('{date}', confirming ? dayLabel(confirming.date, locale) : '')}
                confirmLabel={t('advances_confirm_button').replace('{amount}', confirming ? money(confirming.amount) : '')}
                onConfirm={confirm}
                onCancel={() => setConfirming(null)}
            />
        </Page>
    )
}
