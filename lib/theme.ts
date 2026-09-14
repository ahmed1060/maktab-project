/**
 * Theme resolution, shared by the server that stamps it and the client that
 * toggles it.
 *
 * Two states. It was three — light, dark and "follow the operating system" —
 * and dropping the third was a deliberate trade, made with the numbers in
 * front of us: 19 of 20 Users and 1 of 2 Super Admins were on "system", so it
 * was the state almost everybody was actually in.
 *
 * What is gained is the control rather than the palette. Three states can only
 * be a cycle, and a cycle has to choose between naming the state it is in and
 * naming what clicking does; it cannot do both. Two fit a segmented toggle,
 * where both options are visible and one is marked. The root element is also
 * now always stamped, so there is no state served by a media query alone and
 * no flash to design around.
 *
 * What is given up: somebody who switches their laptop to dark at sunset
 * switches this app separately.
 */

export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

export const DEFAULT_THEME: Theme = 'light'

/**
 * The value this used to allow, still sitting in stored columns and in cookies
 * and session tokens issued before the change.
 *
 * Nothing writes it any more, and `parseTheme` folds it into the default — the
 * decision was to map everyone on it to light rather than resolve each person
 * against their operating system. It is named here rather than left as a bare
 * string so the migrate step that clears it, and the contract step that stops
 * tolerating it, both have something to refer to.
 */
export const LEGACY_THEME = 'system'

/** The cookie is what makes the stamp work on pages with no session. */
export const THEME_COOKIE = 'NEXT_THEME'
export const THEME_COOKIE_MAX_AGE = 31536000 // one year, matching NEXT_LOCALE

export function isTheme(value: unknown): value is Theme {
    return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

/**
 * Anything unrecognised becomes the default, which is what quietly retires
 * "system": a stored value, cookie or token still carrying it resolves to
 * light without any branch anywhere having to know about it.
 */
export function parseTheme(value: unknown): Theme {
    return isTheme(value) ? value : DEFAULT_THEME
}

/**
 * What to put in `data-theme` on <html>.
 *
 * Always something now. While "system" existed this returned undefined for it,
 * because that state had to be served by the prefers-color-scheme media query
 * and an attribute would have had to win against it in both directions. With
 * two explicit states every render is stamped, which is what makes the media
 * copy of the dark palette dead weight.
 */
export function themeAttribute(theme: Theme): Theme {
    return theme
}
