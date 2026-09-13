'use client'
import RequestsSection from '@/components/requests/RequestsSection'
import { useEffect } from 'react'
import { useHeader } from '@/context/HeaderContext'
import { useLanguage } from '@/context/LanguageContext'
import { useModules } from '@/lib/useModules'

export default function RequestsPage({ userRole }: { userRole: string }) {
    const { setTitle, setSubtitle } = useHeader()
    const modules = useModules()
    const { t } = useLanguage()

    useEffect(() => {
        setTitle(modules.label('requests'))
        setSubtitle(t('requests_subtitle' as any))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t, modules])

    return (
        <div style={{ padding: '0' }}>
            <RequestsSection userRole={userRole} />
        </div>
    )
}
