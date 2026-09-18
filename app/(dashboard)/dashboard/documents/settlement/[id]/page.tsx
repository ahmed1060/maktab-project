'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import DocumentFrame from '@/components/DocumentFrame'

type Doc = {
    person: { name: string; email: string }
    company: { name: string; logoUrl?: string | null }
    lastWorkingDay: string
    earned: number
    paid: number
    net: number
    direction: 'COMPANY_OWES' | 'PERSON_OWES' | 'SETTLED'
    status: string
    dueDate: string
    reason?: string | null
}

export default function SettlementDocumentPage() {
    const { t, locale } = useLanguage()
    const params = useParams()
    const isRtl = locale === 'ar'

    const [doc, setDoc] = useState<Doc | null>(null)
    const [error, setError] = useState(false)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`/api/settlements/${params.id}`)
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
        new Intl.NumberFormat(isRtl ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n))
    const date = (d: string) => new Date(d).toLocaleDateString(isRtl ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

    if (loading) return <LoadingSpinner />
    if (error || !doc) return <p style={{ padding: '2rem' }}>{t('doc_not_found')}</p>

    const field = (label: string, value: string) => (
        <div>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>{label}</div>
            <div style={{ fontWeight: 600 }}>{value}</div>
        </div>
    )

    const row = (label: string, value: string, negative = false) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.35rem 0', fontSize: '0.95rem' }}>
            <span>{label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{negative ? '−' : ''}{value}</span>
        </div>
    )

    // The label is chosen from the sign, in one place, so the wording and the
    // figure cannot disagree — the one thing this document must never do.
    const verdict = {
        COMPANY_OWES: { text: t('doc_company_owes'), color: 'var(--ok-fg)', bg: 'var(--ok-bg)' },
        PERSON_OWES: { text: t('doc_person_owes'), color: 'var(--danger-fg)', bg: 'var(--danger-bg)' },
        SETTLED: { text: t('doc_settled'), color: 'var(--text-muted)', bg: 'var(--surface-sunk)' },
    }[doc.direction]

    return (
        <DocumentFrame title={t('doc_settlement')} company={doc.company}>
            <div style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap', marginBottom: '1.75rem' }}>
                {field(t('doc_issued_to'), doc.person.name)}
                {field(t('doc_last_working_day'), date(doc.lastWorkingDay))}
                {field(t('doc_due'), date(doc.dueDate))}
            </div>

            {/* Two sides, both shown. A statement that printed only the net would
                be arithmetic somebody has to take on trust; printing what was
                earned beside what had already gone out is what lets them check
                it. */}
            <section style={{ marginBottom: '1.25rem' }}>
                {row(t('doc_earned'), money(doc.earned))}
                {row(t('doc_already_paid'), money(doc.paid), true)}
            </section>

            <div style={{
                borderTop: '2px solid var(--text-strong)', paddingTop: '0.75rem',
                display: 'flex', justifyContent: 'space-between', gap: '1rem',
                fontSize: '1.15rem', fontWeight: 700,
            }}>
                <span>{t('doc_net')}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(doc.net)}</span>
            </div>

            <p style={{
                marginTop: '0.75rem', padding: '0.6rem 0.9rem', borderRadius: '0.5rem',
                background: verdict.bg, color: verdict.color, fontWeight: 600, fontSize: '0.95rem',
            }}>
                {verdict.text}
            </p>

            {doc.reason && (
                <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {t('doc_reason')}: {doc.reason}
                </p>
            )}
        </DocumentFrame>
    )
}
