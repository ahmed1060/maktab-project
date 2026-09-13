"use client"

import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { parseTheme, THEME_COOKIE, THEME_COOKIE_MAX_AGE, themeAttribute, type Theme } from '@/lib/theme'

type ThemeContextValue = {
    theme: Theme
    setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'system', setTheme: () => { } })

export const useTheme = () => useContext(ThemeContext)

/**
 * Applies and persists the theme. It does not decide the initial one — the root
 * layout already stamped that server-side from the cookie, which is what stops
 * the page painting light and repainting dark.
 *
 * Mirrors LanguageContext: cookie for the server to read on the next request,
 * account column so the preference follows the person to another browser.
 */
export function ThemeProvider({ initialTheme, children }: { initialTheme: Theme; children: React.ReactNode }) {
    const { data: session } = useSession()
    const [theme, setThemeState] = useState<Theme>(initialTheme)

    const apply = useCallback((next: Theme) => {
        const attr = themeAttribute(next)
        // "system" removes the attribute rather than setting one, so the
        // prefers-color-scheme media query takes over again.
        if (attr) document.documentElement.setAttribute('data-theme', attr)
        else document.documentElement.removeAttribute('data-theme')

        document.cookie = `${THEME_COOKIE}=${next};path=/;max-age=${THEME_COOKIE_MAX_AGE};samesite=lax`
    }, [])

    const setTheme = useCallback((next: Theme) => {
        setThemeState(next)
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
    // yet; adopt it once, without writing back.
    useEffect(() => {
        const stored = (session?.user as any)?.theme
        if (!stored) return
        const fromAccount = parseTheme(stored)
        const hasCookie = document.cookie.split('; ').some(row => row.startsWith(`${THEME_COOKIE}=`))
        if (!hasCookie && fromAccount !== theme) {
            setThemeState(fromAccount)
            apply(fromAccount)
        }
    }, [session, theme, apply])

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    )
}
