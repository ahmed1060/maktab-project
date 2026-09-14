'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import EmailSection from '@/components/security/EmailSection'
import MfaSection from '@/components/security/MfaSection'

/**
 * Email and two-factor authentication on one screen — both answers to "how do
 * I get into this account", which is why they were never really two settings.
 *
 * The page has two states, and the difference is not cosmetic.
 *
 * Unverified: this is a gate. middleware.ts redirects every dashboard route
 * here until the address is confirmed, so it shows the email section alone, in
 * its own framing, with no page header and nothing else to look at. Offering to
 * set up an authenticator app to somebody who cannot yet reach the dashboard is
 * two jobs at the worst possible moment.
 *
 * Verified: this is a settings screen, with a header and both sections.
 */
export default function SecuritySettingsPage() {
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const { data: session } = useSession()

    const isAr = locale === 'ar'
    const isVerified = !!session?.user?.emailVerified

    useEffect(() => {
        // No header while the gate is up: the section supplies its own framing,
        // and a settings-page title over a "you must verify" card reads as
        // though the rest of the screen failed to load.
        if (!isVerified) return
        setTitle(t('security_settings_nav'))
        setSubtitle(t('security_settings_subtitle'))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t, isVerified])

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            maxWidth: '460px',
            width: '100%',
            marginInline: 'auto',
            paddingBlock: isVerified ? '0' : '3rem',
            direction: isAr ? 'rtl' : 'ltr',
        }}>
            <EmailSection />
            {isVerified && <MfaSection />}
        </div>
    )
}
