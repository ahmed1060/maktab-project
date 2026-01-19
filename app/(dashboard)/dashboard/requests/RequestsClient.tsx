'use client'
import RequestsSection from '@/components/requests/RequestsSection'
import { useLanguage } from '@/context/LanguageContext'

export default function RequestsPage({ userRole }: { userRole: string }) {
    const { t, locale } = useLanguage()

    return (
        <div style={{ padding: '0 1rem' }}>
            <h1 style={{ fontSize: '2rem', fontWeight: '800', color: '#1e293b', marginBottom: '2rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                🤝 {t('requests')}
            </h1>
            <RequestsSection userRole={userRole} />
        </div>
    )
}
