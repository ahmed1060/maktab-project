'use client'

import type { ReactNode } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import LanguageToggleButton from '@/components/LanguageToggleButton'
import ThemeToggleButton from '@/components/ThemeToggleButton'
import { SignInSignature } from '@/components/PoweredBy'

/**
 * The sign-in screen (DESIGN.md §5.5, Sign-in), the one screen with no app
 * shell: a card on the flat page, its title saying what's done here, with a
 * line under it on what to type for a step that needs one, then the step.
 * The line can name what was typed, such as the email a code was sent to.
 *
 * Under the card, as part of the page: the legal pages, which have to be
 * reachable from the product and not only from Google's consent screen, and
 * the language and theme switches the account menu has. They were pinned to
 * the screen's bottom corners, so on a phone the theme switch covered Sign in
 * and the language switch the legal links (UI_PLAN.md §5 step 5).
 *
 * Then the "Powered by" signature, as the dashboard has it, as System
 * settings has it (decided 2026-11-08): in the corner on a computer, and at
 * the end of the page on a phone.
 */
export function SignInScreen({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
    const { t } = useLanguage()
    return (
        <div className="ui-signin">
            <main className="ui-signin-main">
                <div className="ui-panel ui-signin-card">
                    <div className="ui-signin-head">
                        <h1 className="ui-page-title">{title}</h1>
                        {subtitle && <p className="ui-page-subtitle">{subtitle}</p>}
                    </div>
                    {children}
                </div>
            </main>
            <footer className="ui-signin-foot">
                <div className="ui-signin-links">
                    <a href="/privacy">{t('privacy_policy')}</a>
                    <a href="/terms">{t('terms_of_service')}</a>
                </div>
                <div className="ui-signin-switches">
                    <ThemeToggleButton variant="inline" />
                    <LanguageToggleButton />
                </div>
            </footer>
            <SignInSignature />
        </div>
    )
}
