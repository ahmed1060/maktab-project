/**
 * Theme resolution, shared by the server that stamps it and the client that
 * toggles it.
 *
 * Three states, not a boolean. "system" is the default and means follow the
 * operating system — the thing most people want, and what every app they
 * already use does. A boolean cannot express it, and a two-state toggle quietly
 * overrides a preference the OS already carries.
 */

export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]

export const DEFAULT_THEME: Theme = 'system'

/** The cookie is what makes the stamp work on pages with no session. */
export const THEME_COOKIE = 'NEXT_THEME'
export const THEME_COOKIE_MAX_AGE = 31536000 // one year, matching NEXT_LOCALE

export function isTheme(value: unknown): value is Theme {
    return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

export function parseTheme(value: unknown): Theme {
    return isTheme(value) ? value : DEFAULT_THEME
}

/**
 * What to put in `data-theme` on <html>.
 *
 * "system" stamps nothing on purpose: the default state is served by the
 * prefers-color-scheme media query alone, and an attribute would have to win
 * against it in both directions. Only an explicit choice is stamped.
 */
export function themeAttribute(theme: Theme): 'light' | 'dark' | undefined {
    return theme === 'system' ? undefined : theme
}
