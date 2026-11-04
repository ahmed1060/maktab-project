'use client'

import { Columns, Page, PageHeader } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useViewer } from '@/lib/useCan'
import EmailSection from '@/components/security/EmailSection'
import { TrustedDevices, TwoFactorCard } from '@/components/security/MfaSection'

/**
 * Email and two-factor authentication on one screen — both answers to "how do
 * I get into this account", which is why they were never really two settings.
 *
 * The page has two states, and the difference is not cosmetic.
 *
 * Unverified: this is a gate. proxy.ts redirects every dashboard route here
 * until the address is confirmed, so it shows the email alone, under a page
 * header that says what it's for, with nothing else to look at. Offering to
 * set up an authenticator app to somebody who cannot yet reach the dashboard
 * is two jobs at the worst possible moment.
 *
 * Verified: this is a settings screen, with the email and two-factor cards
 * side by side, and the trusted devices under them while two-factor is on.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, the pages left). Which state
 * it's in comes from the layout on the first paint: read from the session
 * hook, still loading then, the gate showed itself to everybody for a moment.
 * Its title was set into the old top bar, and the gate had none.
 */
export default function SecuritySettingsPage() {
    const { t } = useLanguage()
    const viewer = useViewer()
    const isVerified = !!viewer?.emailVerified
    const mfaEnabled = !!viewer?.mfaEnabled

    if (!isVerified) {
        return (
            <Page>
                <PageHeader title={t('verify_email_required_title')} subtitle={t('verify_email_required_message')} />
                <EmailSection gate />
            </Page>
        )
    }

    return (
        <Page>
            <PageHeader title={t('security_settings_nav')} subtitle={t('security_settings_subtitle')} />
            <Columns>
                <EmailSection gate={false} />
                <TwoFactorCard />
            </Columns>
            {mfaEnabled && <TrustedDevices />}
        </Page>
    )
}
