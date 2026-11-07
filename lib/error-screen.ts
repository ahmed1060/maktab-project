import { resolveLocale } from '@/lib/locale'
import { parseTheme, THEME_COOKIE, type Theme } from '@/lib/theme'
import { SCOPED_COMPANY_COOKIE } from '@/lib/company-scope'
import { clearStorageKeepingPhone } from '@/lib/mobile/kept-storage'
import type { Locale } from '@/lib/translations'

/**
 * The error screens (DESIGN.md §5.5, "A page that broke" and "When the app
 * itself broke"; PR 219): what they say, and what Start again does.
 *
 * Small and with no other imports than these, as app/global-error.tsx reads
 * it, and that screen is in every page's code.
 */

export const ERROR_SCREEN_KEYS = ['error_screen_title', 'error_screen_detail', 'error_screen_reload', 'error_screen_start_again', 'error_screen_reference'] as const
export type ErrorScreenWords = Record<(typeof ERROR_SCREEN_KEYS)[number], string>

/**
 * The words for the one screen that has no dictionary to read them from: when
 * the app itself broke, nothing of it is there, its words included, and the
 * dictionaries are too big to put in every page's code for it. The
 * translations' own, word for word (lib/error-screens-blocks.test.ts), so a
 * page that broke reads them from there.
 */
export const ERROR_SCREEN_WORDS: Record<Locale, ErrorScreenWords> = {
    en: {
        error_screen_title: "This page stopped working",
        error_screen_detail: "Reloading the page usually puts it right. If it keeps happening, start again: that clears what this browser keeps for the app, and you stay signed in.",
        error_screen_reload: "Reload page",
        error_screen_start_again: "Start again",
        error_screen_reference: "To report it, share this reference with your Admin: {ref}",
    },
    ar: {
        error_screen_title: "توقفت هذه الصفحة عن العمل",
        error_screen_detail: "عادةً ما تُصلح إعادة تحميل الصفحة ذلك. وإذا تكرر، يُرجى البدء من جديد: يمسح ذلك ما يحفظه هذا المتصفح للتطبيق، مع بقاء تسجيل الدخول.",
        error_screen_reload: "إعادة تحميل الصفحة",
        error_screen_start_again: "البدء من جديد",
        error_screen_reference: "وللإبلاغ عن ذلك، يُرجى مشاركة هذا المرجع مع المسؤول: {ref}",
    },
}

function cookie(cookies: string, name: string): string | null {
    for (const part of cookies.split(';')) {
        const at = part.indexOf('=')
        if (at > 0 && part.slice(0, at).trim() === name) {
            try { return decodeURIComponent(part.slice(at + 1).trim()) } catch { return null }
        }
    }
    return null
}

/**
 * The language and theme the person chose, for the screen drawn without the
 * app around it, from the cookies the app keeps them in: the language as the
 * server picks it (lib/locale.ts), the browser's own when there's no choice
 * yet, and the theme as lib/theme.ts reads it.
 */
export function errorScreenLook(cookies: string, browserLanguage?: string | null): { locale: Locale; dir: 'ltr' | 'rtl'; theme: Theme } {
    const locale = resolveLocale(cookie(cookies, 'NEXT_LOCALE'), browserLanguage)
    return { locale, dir: locale === 'ar' ? 'rtl' : 'ltr', theme: parseTheme(cookie(cookies, THEME_COOKIE)) }
}

/**
 * Start again: clears what this browser keeps for the app, the phone's own
 * records apart (lib/mobile/kept-storage.ts), and forgets the company a Super
 * Admin last picked, whose cookie the server reads beside it. The language and
 * theme are kept, and so is the session, as they're cookies of their own; then
 * the page is loaded again.
 */
export function startAgain(
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'clear'>,
    doc: { cookie: string } = globalThis.document,
    reload: () => void = () => globalThis.location.reload(),
) {
    // Read in here: with storage turned off, even reading localStorage throws.
    try { clearStorageKeepingPhone(storage ?? globalThis.localStorage) } catch { /* Nothing kept there, then. */ }
    doc.cookie = `${SCOPED_COMPANY_COOKIE}=;path=/;max-age=0;samesite=lax`
    reload()
}
