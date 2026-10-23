'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import DocumentFrame from '@/components/DocumentFrame'
import { fetchRetrying } from '@/lib/swr-fetcher'

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
    const isRtl = locale === 'ar'

    const [doc, setDoc] = useState<Doc | null>(null)
    const [error, setError] = useState(false)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        (async () => {
            try {
                const res = await fetchRetrying(`/api/payslips/${params.id}`)
                if (!res.ok) { setError(true); return }
                setDoc((await res.json()).data)
            } catch {
                setError(true)
            } finally {
                setLoading(false)
            }
        })()
    }, [params.id])

    const money = (n: number) =>
        new Intl.NumberFormat(isRtl ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

    if (loading) return <LoadingSpinner />
    if (error || !doc) return <p style={{ padding: '2rem' }}>{t('doc_not_found')}</p>

    const monthName = new Date(2000, doc.period.month - 1)
        .toLocaleString(isRtl ? 'ar-EG' : 'en-US', { month: 'long' })

    const field = (label: string, value: string) => (
        <div>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>{label}</div>
            <div style={{ fontWeight: 600 }}>{value}</div>
        </div>
    )

    const row = (label: string, value: string, opts: { strong?: boolean; negative?: boolean; key?: string } = {}) => (
        <div key={opts.key} style={{
            display: 'flex', justifyContent: 'space-between', gap: '1rem',
            padding: opts.strong ? '0.6rem 0 0' : '0.3rem 0',
            borderTop: opts.strong ? '2px solid var(--text-strong)' : undefined,
            marginTop: opts.strong ? '0.5rem' : undefined,
            fontSize: opts.strong ? '1.05rem' : '0.95rem',
            fontWeight: opts.strong ? 700 : 400,
        }}>
            <span>{label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {opts.negative ? '−' : ''}{value}
            </span>
        </div>
    )

    const earnings = doc.lines.filter(l => l.kind === 'EARNING')
    const deductions = doc.lines.filter(l => l.kind === 'DEDUCTION')

    return (
        <DocumentFrame title={t('doc_payslip')} company={doc.company}>
            {/* A draft says so on its face. A payslip that turns out to have been
                provisional, without having said so, is worse than no payslip. */}
            {doc.status === 'DRAFT' && (
                <p style={{
                    margin: '0 0 1rem', padding: '0.6rem 0.9rem', borderRadius: '0.5rem',
                    background: 'var(--warn-bg)', color: 'var(--warn-fg)', fontSize: '0.85rem',
                }}>
                    {t('doc_draft_note')}
                </p>
            )}

            <div style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap', marginBottom: '1.75rem' }}>
                {field(t('doc_issued_to'), doc.person.name)}
                {field(t('doc_period'), `${monthName} ${doc.period.year}`)}
                {field(t('doc_days_paid'), String(doc.daysPaid))}
            </div>

            {doc.excluded && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                    {t('doc_excluded_note').replace('{reason}', doc.exclusionReason || '')}
                </p>
            )}

            <section style={{ marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', margin: '0 0 0.35rem' }}>
                    {t('doc_earnings')}
                </h3>
                {earnings.map((l, i) => row(l.label, money(l.amount), { key: `e${i}` }))}
                {row(t('doc_earnings'), money(doc.earnings), { strong: true })}
            </section>

            {deductions.length > 0 && (
                <section style={{ marginBottom: '1.25rem' }}>
                    <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', margin: '0 0 0.35rem' }}>
                        {t('doc_deductions')}
                    </h3>
                    {deductions.map((l, i) => row(l.label, money(l.amount), { negative: true, key: `d${i}` }))}
                    {row(t('doc_deductions'), money(doc.deductions), { strong: true, negative: true })}
                </section>
            )}

            {row(t('doc_net'), money(doc.net), { strong: true })}

            {/* The net floors at zero, so what the deductions could not take has
                to be said somewhere or it simply disappears from the document
                that was supposed to account for it. */}
            {doc.carried > 0 && (
                <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {t('doc_carried_note').replace('{amount}', money(doc.carried))}
                </p>
            )}
        </DocumentFrame>
    )
}
