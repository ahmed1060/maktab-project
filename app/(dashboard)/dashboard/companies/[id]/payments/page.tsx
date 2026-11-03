'use client'

import { useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { useParams } from 'next/navigation'
import { CalendarBlankIcon, CheckCircleIcon, CurrencyDollarIcon, HourglassIcon, PlusIcon, ReceiptIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import { refusalOf } from '@/components/CompanyRolesCard'
import DeleteTemplateDialog from '@/components/DeleteTemplateDialog'
import { AddPaymentDialog, MarkPaidDialog, namedPayment, paymentDay, PERIOD_LABEL_KEY, type Payment } from '@/components/PaymentDialogs'
import { Button, DataList, EmptyState, ItemTitle, ListCard, Page, PageHeader, RowMenu, StatusBadge, type Column } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { platformMoney } from '@/lib/subscription-display'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useViewer } from '@/lib/useCan'

/**
 * A company's payments, opened from its row in Companies (the Super Admin's
 * pages part 3b, UI_PLAN.md §5 step 5): what each pays for, its amount, the
 * period it covers and whether it's paid, a table on computers and cards on
 * phones. An unpaid one can be marked paid, which asks first and says the
 * period it starts, or deleted; a paid one stays as it is, as the server keeps it.
 */
export default function CompanyPaymentsPage() {
    const { id: companyId } = useParams() as { id: string }
    // Who is looking comes from the layout on the first paint, so a Super
    // Admin never sees "Access restricted" while the session loads.
    const viewer = useViewer()
    const isSuperAdmin = viewer?.role === 'SUPER_ADMIN'
    const { t, locale } = useLanguage()
    const { showToast } = useToast()

    const { data: companyResult } = useSWR(isSuperAdmin && companyId ? `/api/companies?id=${encodeURIComponent(companyId)}` : null, fetcher)
    const companyName: string | undefined = companyResult?.data?.name
    const { data, error, isValidating, mutate } = useSWR(isSuperAdmin && companyId ? `/api/companies/${encodeURIComponent(companyId)}/payments` : null, fetcher)
    const payments: Payment[] | null = data?.data ?? null

    const [adding, setAdding] = useState(false)
    // By its id, so the period the dialog says is the list's latest.
    const [paying, setPaying] = useState<string | null>(null)
    const [removing, setRemoving] = useState<Payment | null>(null)
    const [busy, setBusy] = useState(false)

    if (!isSuperAdmin) return <AccessDenied />

    const paymentName = (p: Payment) => namedPayment(t, locale, p)
    const payingNow = payments?.find(p => p.id === paying && p.status === 'UNPAID')
    const money = (p: Payment) => <span className="ui-num">{platformMoney(p.cost, locale)}</span>

    const act = async (run: () => Promise<Response>, done: string, after: () => void) => {
        setBusy(true)
        try {
            const res = await run()
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            showToast(done, 'success')
            after()
            await mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }
    const address = (p: Payment) => `/api/companies/${encodeURIComponent(companyId)}/payments/${encodeURIComponent(p.id)}`
    const markPaid = (p: Payment) => act(
        () => fetch(address(p), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'PAID' }) }),
        t('payments_marked'),
        () => setPaying(null),
    )
    const remove = (p: Payment) => act(() => fetch(address(p), { method: 'DELETE' }), t('payments_deleted'), () => setRemoving(null))

    // The period it covers once it's paid. A lifetime one has no end, and
    // says so, where reading its missing end as a date printed 1 January 1970.
    const covers = (p: Payment) => {
        if (p.status !== 'PAID' || !p.startDate) return t('payments_starts_when_paid')
        const from = paymentDay(p.startDate, locale)
        return p.endDate
            ? t('payments_period').replace('{from}', from).replace('{to}', paymentDay(p.endDate, locale))
            : t('payments_period_lifetime').replace('{from}', from)
    }
    const status = (p: Payment) => p.status === 'PAID'
        ? <StatusBadge tone="good">{t('payments_paid')}</StatusBadge>
        : <StatusBadge tone="waiting">{t('payments_unpaid')}</StatusBadge>
    // Only an unpaid one has anything to do: marking it paid, or deleting it.
    const actions = (p: Payment) => p.status === 'UNPAID' && (
        <span className="ui-row-actions">
            {/* The list is asked again as it opens, so a page left open overnight doesn't promise a period from yesterday. */}
            <Button size="sm" icon={CheckCircleIcon} aria-label={t('payments_mark_paid_for').replace('{name}', paymentName(p))}
                onClick={() => { setPaying(p.id); void mutate() }}>{t('mark_as_paid')}</Button>
            <RowMenu label={t('ui_more_actions_for').replace('{name}', paymentName(p))} tooltip={t('ui_more_actions')}
                items={[{ key: 'delete', label: t('delete'), icon: TrashIcon, danger: true, onSelect: () => setRemoving(p) }]} />
        </span>
    )

    const columns: Column<Payment>[] = [
        { key: 'for', header: t('payments_for'), cell: p => <ItemTitle title={t(PERIOD_LABEL_KEY[p.subscriptionType])} detail={t('payments_added_on').replace('{date}', paymentDay(p.createdAt, locale))} /> },
        { key: 'amount', header: t('payments_amount'), align: 'end', cell: money },
        { key: 'covers', header: t('payments_covers'), cell: covers },
        { key: 'status', header: t('status_label'), cell: status },
        { key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end', cell: actions },
    ]

    let list: ReactNode
    if (!payments) {
        list = error ? (
            <div className="ui-panel">
                <EmptyState icon={WarningCircleIcon} title={t('payments_load_failed')} detail={(error as SWRError).info?.error}
                    action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
            </div>
        ) : (
            <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        )
    } else {
        list = (
            <DataList
                caption={t('companies_payments')}
                columns={columns}
                rows={payments}
                rowKey={p => p.id}
                empty={<EmptyState icon={ReceiptIcon} title={t('payments_none')} detail={t('payments_none_hint')} />}
                card={p => (
                    <ListCard
                        title={t(PERIOD_LABEL_KEY[p.subscriptionType])}
                        status={status(p)}
                        details={[
                            { icon: CurrencyDollarIcon, text: money(p) },
                            { icon: CalendarBlankIcon, text: covers(p) },
                        ]}
                        foot={<><span className="ui-hint">{t('payments_added_on').replace('{date}', paymentDay(p.createdAt, locale))}</span>{actions(p)}</>}
                    />
                )}
            />
        )
    }

    return (
        <Page>
            {/* The company is the heading, as on its settings: whose payments these are is where the eye lands first. */}
            <PageHeader
                back={{ href: '/dashboard/companies', label: t('companies') }}
                title={companyName ? <bdi>{companyName}</bdi> : t('companies_payments')}
                subtitle={companyName ? t('companies_payments') : undefined}
                action={<Button variant="primary" icon={PlusIcon} onClick={() => setAdding(true)}>{t('payments_add')}</Button>}
            />
            {list}

            {adding && <AddPaymentDialog companyId={companyId} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); void mutate() }} />}
            {payingNow && <MarkPaidDialog payment={payingNow} busy={busy} onCancel={() => setPaying(null)} onConfirm={() => { void markPaid(payingNow) }} />}
            {removing && (
                <DeleteTemplateDialog
                    name={paymentName(removing)}
                    body={t('payments_delete_body')}
                    busy={busy}
                    onCancel={() => setRemoving(null)}
                    onConfirm={() => { void remove(removing) }}
                />
            )}
        </Page>
    )
}
