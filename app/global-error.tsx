'use client'

import './globals.css'
import '@/components/ui/ui.css'
import { useSyncExternalStore } from 'react'
import { fontVariables } from './fonts'
import { ErrorScreen } from '@/components/ErrorScreen'
import { ERROR_SCREEN_WORDS, errorScreenLook } from '@/lib/error-screen'

/**
 * When the app itself broke (DESIGN.md §5.5): the last net, for a failure
 * Next can't recover from inside the app, such as the root layout throwing,
 * before even the side bar could be drawn and below any of the app's own
 * boundaries (components/DashboardErrorBoundary.tsx). The whole screen says
 * what a page that broke says (components/ErrorScreen.tsx), in the page's
 * colour, with the same buttons and reference.
 *
 * Next draws this page in place of the root layout, so nothing of the app is
 * there: it brings the app's styles and fonts itself, as Next's docs say it
 * must, and the language and theme the person chose from their cookies. Its
 * words are its own copy (lib/error-screen.ts): the dictionaries are the size
 * of all the app's words, and this page is in every page's code.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, PR 219): it was in English
 * only, its Try Again in Title Case, and the app's styles, fonts and the
 * theme the person chose didn't reach it.
 */

// The cookies don't change while this page is up. Read only in the browser:
// the server, drawing this page, has the defaults, which the browser then
// corrects (lib/error-screen.ts).
const unchanging = () => () => { }
const browserCookies = () => document.cookie
const browserLanguage = () => navigator.language
const none = () => null

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
    const look = errorScreenLook(useSyncExternalStore(unchanging, browserCookies, () => ''), useSyncExternalStore(unchanging, browserLanguage, none))
    const words = ERROR_SCREEN_WORDS[look.locale]
    return (
        <html lang={look.locale} dir={look.dir} data-theme={look.theme} className={fontVariables}>
            <body>
                <title>{words.error_screen_title}</title>
                {/* Next gives the root layout's pages their viewport, not this one: without it a
                    phone could draw it at a computer's width (found in the browser flows). */}
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <main className="ui-error-page">
                    <ErrorScreen error={error} words={words} />
                </main>
            </body>
        </html>
    )
}
