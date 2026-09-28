'use client'
import useSWR from 'swr'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'

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
    const isRtl = locale === 'ar'

    const userId = (session?.user as any)?.id
    // The Super Admin is nobody's employee: there are no payslips of theirs to
    // ask for, whether they came here by the address or while previewing a
    // role (which sees this page as the role would).
    const previewing = !!(session?.user as any)?.preview
    const nobodysEmployee = previewing || (session?.user as any)?.role === 'SUPER_ADMIN'

    const { data, error, isLoading } = useSWR(userId && !nobodysEmployee ? `/api/users/${userId}/payslips` : null, fetcher)
    // Not an error: a company that has not switched payslips on is a policy,
    // and telling somebody "access denied" for a setting their employer chose
    // reads like a fault in the app.
    const unavailable = (error as SWRError | undefined)?.status === 403
    const rows: Row[] | null = data ? (data.data ?? []) : error || nobodysEmployee ? [] : null
    // No user id yet means the session is still arriving, not an empty list.
    const loading = !userId || (!nobodysEmployee && isLoading)

    const monthName = (m: number) =>
        new Date(2000, m - 1).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { month: 'long' })

    const money = (n: number) =>
        new Intl.NumberFormat(isRtl ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

    if (loading) return <LoadingSpinner />

    return (
        <div style={{ direction: isRtl ? 'rtl' : 'ltr', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
                <h1 style={{ margin: 0 }}>{t('my_payslips')}</h1>
                <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)' }}>{t('my_payslips_hint')}</p>
            </div>

            <div className="card" style={{ padding: '1.25rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '1rem' }}>
                {unavailable ? (
                    <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t('my_payslips_off')}</p>
                ) : !rows || rows.length === 0 ? (
                    <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t('my_payslips_empty')}</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {rows.map(row => (
                            <a
                                key={row.id}
                                href={`/dashboard/documents/payslip/${row.id}`}
                                style={{
                                    display: 'flex', justifyContent: 'space-between', gap: '1rem',
                                    alignItems: 'baseline', flexWrap: 'wrap',
                                    padding: '0.85rem 0', borderTop: '1px solid var(--border)',
                                    color: 'inherit', textDecoration: 'none',
                                }}
                            >
                                <span>
                                    <strong>{monthName(row.month)} {row.year}</strong>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginInlineStart: '0.5rem' }}>
                                        {row.daysPaid} {t('payroll_days_paid')}
                                        {/* Approved but not paid is a real and
                                            visible state: the figures are final
                                            and the money has not moved. Saying
                                            only "payslip" would let somebody
                                            read it as money already sent. */}
                                        {row.status === 'APPROVED' && ` · ${t('payroll_status_APPROVED')}`}
                                    </span>
                                </span>
                                <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(row.net)}</span>
                            </a>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
