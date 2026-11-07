'use client'

import { catchError, type ErrorInfo } from 'next/error'
import { Page } from '@/components/ui'
import { ErrorScreen } from '@/components/ErrorScreen'
import { useLanguage } from '@/context/LanguageContext'
import { ERROR_SCREEN_KEYS, type ErrorScreenWords } from '@/lib/error-screen'

/**
 * A page that broke (DESIGN.md §5.5): its place says so, in the page's
 * language, with Reload page and Start again (components/ErrorScreen.tsx).
 * In the dashboard the side bar and top bar stay around it; on a page with no
 * side bar, such as signing in, it has the whole screen (`standalone`).
 *
 * Next's own boundary (catchError, from next/error), as its docs advise for
 * one that isn't a route's error.js: going to another page leaves it behind,
 * and a redirect or Not found thrown below passes through it to the boundary
 * that handles it.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, PR 219): it was a card of its
 * own making, in English only, under a warning emoji. It told of "a
 * client-side exception", offered Reload Page and a red Reset Settings &
 * Reload, which also switched the app to English, and screen readers weren't
 * told. A class of its own, it stayed when the person went to another page,
 * until the page was reloaded.
 */
export function BrokenPage({ error, standalone = false }: { error: unknown; standalone?: boolean }) {
    const { t } = useLanguage()
    const words = Object.fromEntries(ERROR_SCREEN_KEYS.map(key => [key, t(key)])) as ErrorScreenWords
    const screen = <ErrorScreen error={error} words={words} />
    return standalone ? <main className="ui-error-page">{screen}</main> : <Page>{screen}</Page>
}

function pageBroke({ standalone }: { standalone?: boolean }, { error }: ErrorInfo) {
    return <BrokenPage error={error} standalone={standalone} />
}

export default catchError(pageBroke)
