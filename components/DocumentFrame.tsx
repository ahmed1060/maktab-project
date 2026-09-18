'use client'
import { useLanguage } from '@/context/LanguageContext'

/**
 * The paper a payslip or a settlement is printed on.
 *
 * Shared so the two documents cannot drift apart in the ways that matter on
 * paper — the same margins, the same place for the company's name, the same
 * position for the figure somebody is looking for. Two documents from one
 * employer that do not look like they came from the same employer is a small
 * thing that reads as carelessness about a large one.
 *
 * Deliberately plain: black on white, one accent, nothing that costs toner or
 * survives a photocopier badly. The class the print stylesheet keys on is here
 * rather than on each page, so a new document gets the behaviour by using this.
 */
export default function DocumentFrame({
    title,
    company,
    children,
    actions,
}: {
    title: string
    company: { name: string; logoUrl?: string | null }
    children: React.ReactNode
    /**
     * Anything else that acts on this document, placed beside Print rather than
     * inside the sheet. The row is no-print for the same reason: a button that
     * appeared on the printed page would be a button on a piece of paper.
     */
    actions?: React.ReactNode
}) {
    const { t, locale } = useLanguage()
    const isRtl = locale === 'ar'

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', direction: isRtl ? 'rtl' : 'ltr' }}>
            <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
                {actions}
                <button className="btn btn-primary" onClick={() => window.print()}>
                    {t('doc_print')}
                </button>
            </div>

            <article
                className="print-document"
                style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.75rem',
                    padding: '2.5rem',
                    maxWidth: '46rem',
                    margin: '0 auto',
                    width: '100%',
                }}
            >
                <header style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    gap: '1rem', borderBottom: '2px solid var(--text-strong)', paddingBottom: '0.75rem',
                }}>
                    <div>
                        <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{company.name}</div>
                        <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                            {title}
                        </div>
                    </div>
                    {company.logoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={company.logoUrl} alt="" style={{ height: '2.5rem', objectFit: 'contain' }} />
                    )}
                </header>

                <div style={{ marginTop: '1.5rem' }}>{children}</div>
            </article>
        </div>
    )
}
