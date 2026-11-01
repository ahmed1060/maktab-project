'use client'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { HourglassIcon, LockSimpleIcon, ReceiptIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, EmptyState, Page, PageHeader, Row, Rows, StatusBadge } from '@/components/ui'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'

/**
 * A person's own payslips.
 *
 * G5: the payslip document rendered correctly at a URL nothing in the product
 * linked to, so the only way one ever reached anybody was the email. This is
 * the other half — the place somebody looks when they want last month's rather
 * than waiting for it to arrive.
 *
 * Deliberately the whole of /dashboard/documents rather than a page beneath it.
 * A folder whose index 404s while its children work is a folder somebody
 * eventually links to by accident.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, Documents part 1, PR 154): the
 * page header, a row for each payslip that opens it, in the page's language,
 * and loading, switched off, failed and empty each saying so.
 */

type Row = {
    id: string
    month: number
    year: number
    status: 'APPROVED' | 'PAID'
    paidAt: string | null
    net: number
    daysPaid: number
}

export default function MyPayslipsPage() {
    const { t, locale } = useLanguage()
    const { data: session } = useSession()
    const digits = locale === 'ar' ? 'ar-EG' : 'en-GB'

    const userId = (session?.user as any)?.id
    // The Super Admin is nobody's employee: there are no payslips of theirs to
    // ask for, whether they came here by the address or while previewing a
    // role (which sees this page as the role would).
    const previewing = !!(session?.user as any)?.preview
    const nobodysEmployee = previewing || (session?.user as any)?.role === 'SUPER_ADMIN'

    const { data, error, isLoading, isValidating, mutate } = useSWR(userId && !nobodysEmployee ? `/api/users/${userId}/payslips` : null, fetcher)
    // Not an error: a company that has not switched payslips on is a policy,
    // and telling somebody "access denied" for a setting their employer chose
    // reads like a fault in the app.
    const unavailable = (error as SWRError | undefined)?.status === 403
    // Anything else that failed says so: passing for none, it said there were
    // no payslips when there were (PR 154).
    const failed = !!error && !unavailable
    const rows: Row[] | null = data ? (data.data ?? []) : nobodysEmployee ? [] : null
    // No user id yet means the session is still arriving, not an empty list.
    const loading = !userId || (!nobodysEmployee && isLoading)

    // "October 2026", the year in the page's digits too.
    const period = (row: Row) => new Date(row.year, row.month - 1).toLocaleString(digits, { month: 'long', year: 'numeric' })
    const money = (n: number) =>
        new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

    const header = <PageHeader title={t('my_payslips')} subtitle={t('my_payslips_hint')} />
    const panel = (body: React.ReactNode) => <Page>{header}<div className="ui-panel">{body}</div></Page>

    if (loading) return <Page>{header}<div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div></Page>
    if (unavailable) return panel(<EmptyState icon={LockSimpleIcon} title={t('my_payslips_off')} />)
    if (failed) return panel(
        <EmptyState icon={WarningCircleIcon} title={t('my_payslips_load_failed')} detail={(error as SWRError).info?.error}
            action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />,
    )
    if (!rows || rows.length === 0) return panel(<EmptyState icon={ReceiptIcon} title={t('my_payslips_empty')} />)

    return (
        <Page>
            {header}
            <Rows label={t('my_payslips')}>
                {rows.map(row => (
                    <Row
                        key={row.id}
                        href={`/dashboard/documents/payslip/${row.id}`}
                        title={period(row)}
                        detail={t('payroll_days_paid_n').replace('{n}', row.daysPaid.toLocaleString(digits))}
                        end={<>
                            {/* Approved but not paid is a real and visible state: the figures are final and the
                                money has not moved. Saying only "payslip" would let somebody read it as money
                                already sent. */}
                            {row.status === 'APPROVED' && <StatusBadge tone="waiting">{t('my_payslips_not_paid')}</StatusBadge>}
                            <bdi className="ui-row-amount">{money(row.net)}</bdi>
                        </>}
                    />
                ))}
            </Rows>
        </Page>
    )
}
