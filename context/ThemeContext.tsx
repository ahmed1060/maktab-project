"use client"

import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { DEFAULT_THEME, parseTheme, THEME_COOKIE, THEME_COOKIE_MAX_AGE, themeAttribute, type Theme } from '@/lib/theme'

type ThemeContextValue = {
    theme: Theme
    setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({ theme: DEFAULT_THEME, setTheme: () => { } })

export const useTheme = () => useContext(ThemeContext)

/**
 * Applies and persists the theme. It does not decide the initial one — the root
 * layout already stamped that server-side from the cookie, which is what stops
 * the page painting light and repainting dark.
 *
 * Mirrors LanguageContext: cookie for the server to read on the next request,
 * account column so the preference follows the person to another browser.
 */
export function ThemeProvider({ initialTheme, themeChosen, children }: { initialTheme: Theme; themeChosen: boolean; children: React.ReactNode }) {
    const { data: session } = useSession()
    const [theme, setThemeState] = useState<Theme>(initialTheme)
    // Whether this browser's theme is settled: it arrived with a theme cookie,
    // someone picked one here, or the account's was adopted below.
    const [settled, setSettled] = useState(themeChosen)

    const apply = useCallback((next: Theme) => {
        // Always an attribute now. While "system" existed this had to be able
        // to remove one, so the media query could take back over.
        document.documentElement.setAttribute('data-theme', themeAttribute(next))
        document.cookie = `${THEME_COOKIE}=${next};path=/;max-age=${THEME_COOKIE_MAX_AGE};samesite=lax`
    }, [])

    const setTheme = useCallback((next: Theme) => {
        setThemeState(next)
        setSettled(true)
        apply(next)

        // Fire-and-forget: the theme is already applied locally, and failing to
        // reach the server should not undo what the person just chose. The
        // cookie carries it until the next successful save.
        if (session?.user) {
            fetch('/api/user/theme', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme: next }),
            }).catch(() => { })
        }
    }, [apply, session])

    // A sign-in on a fresh browser has the account's preference but no cookie
    // yet; adopt it once, without writing back to the account. Decided during
    // render rather than in an effect, which painted the default theme first.
    const accountTheme = (session?.user as any)?.theme
    if (!settled && accountTheme) {
        setSettled(true)
        const fromAccount = parseTheme(accountTheme)
        if (fromAccount !== theme) setThemeState(fromAccount)
    }

    // Stamp the document and the cookie once the theme differs from the one
    // the server already stamped. Not on first load: writing the cookie then
    // would mark this browser as settled before anyone has signed in, and the
    // account's preference would never be adopted.
    useEffect(() => {
        if (theme !== initialTheme) apply(theme)
    }, [theme, initialTheme, apply])

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    )
}
