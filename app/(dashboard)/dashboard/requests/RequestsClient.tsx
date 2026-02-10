'use client'
import RequestsSection from '@/components/requests/RequestsSection'
import { useEffect } from 'react'
import { useHeader } from '@/context/HeaderContext'
import { useLanguage } from '@/context/LanguageContext'

export default function RequestsPage({ userRole }: { userRole: string }) {
    const { setTitle, setSubtitle } = useHeader()
    const { t } = useLanguage()

    useEffect(() => {
        setTitle(t('requests'))
        setSubtitle(t('requests_subtitle' as any))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t])

    return (
        <div style={{ padding: '0' }}>
            <RequestsSection userRole={userRole} />
        </div>
    )
}
