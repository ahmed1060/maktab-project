import type { ReactNode } from 'react'
import { CompanyMark } from '@/components/ui/Avatar'
import { APP_NAME } from '@/lib/page-title'
import { en } from '@/lib/translations/en'

/**
 * The page around the privacy policy and the terms of service (DESIGN.md
 * §5.5): Nizmo's mark and name at its top, a link to sign in, the document on
 * a sheet at reading width, and the links under it. As with sign-in, there's
 * no side bar and no top bar.
 *
 * Its own route group rather than a path segment, so the URLs stay short —
 * Google's OAuth consent screen wants a privacy policy link, and a shorter
 * one is easier to read back over the phone than /legal/privacy.
 *
 * Deliberately outside every auth boundary. The proxy only demands a token
 * for paths starting /dashboard, so these render for a signed-out visitor
 * with no exception added; that matters because Google fetches the URL
 * without a session, and a page that redirects to /login fails its check
 * (lib/public-legal-pages.test.ts).
 *
 * In English only, the language that governs them (the note at the foot of
 * each), so the whole page is, its frame too: left to right, and marked as
 * English. The root layout marks the page as Arabic for someone using the app
 * in Arabic, and a screen reader would read the English as Arabic.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, PR 220): it was a column of
 * its own making on the older pages' grey, under Nizmo's name in spaced
 * capitals, with the links under it in Title Case.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
    return (
        <div className="ui-legal" lang="en" dir="ltr">
            <header className="ui-legal-head">
                <a href="/login" className="ui-legal-brand">
                    <CompanyMark name={APP_NAME} logoUrl={null} />
                    <span>{APP_NAME}</span>
                </a>
            </header>
            <main className="ui-legal-main">
                <article className="ui-panel ui-legal-doc">{children}</article>
            </main>
            <footer className="ui-legal-foot">
                <a href="/privacy">{en.privacy_policy}</a>
                <a href="/terms">{en.terms_of_service}</a>
                <a href="/login">{en.sign_in}</a>
            </footer>
        </div>
    )
}
