import type { Locale } from '@/lib/translations'

/**
 * The locale a request is rendered in: the NEXT_LOCALE cookie when it holds a
 * real choice, otherwise the browser's first preferred language.
 *
 * The fallback used to happen in the browser — the server rendered English, and
 * an effect then read navigator.language and switched an Arabic browser to
 * Arabic, a full English paint later. navigator.language is the first entry
 * of the Accept-Language header the browser sends anyway, so the server can
 * make the same decision before anything is painted.
 */
export function resolveLocale(cookie: string | undefined | null, acceptLanguage: string | undefined | null): Locale {
    if (cookie === 'en' || cookie === 'ar') return cookie
    const first = (acceptLanguage ?? '').split(',')[0]?.split(';')[0]?.trim().toLowerCase() ?? ''
    return first.split('-')[0] === 'ar' ? 'ar' : 'en'
}
