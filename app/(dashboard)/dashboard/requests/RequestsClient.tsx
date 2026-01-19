'use client'
import RequestsSection from '@/components/requests/RequestsSection'
import { useLanguage } from '@/context/LanguageContext'

export default function RequestsPage({ userRole }: { userRole: string }) {
    const { t, locale } = useLanguage()

    return (
        <div style={{ padding: '0' }}>
            <RequestsSection userRole={userRole} />
        </div>
    )
}
