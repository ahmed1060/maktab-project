export type Locale = 'en' | 'ar'

// Type-only import — erased at compile time, so referencing `en` here for
// its key shape adds nothing to any bundle (client or server).
import type { en } from './en'

export type TranslationKey = keyof typeof en
export type TranslationDict = Record<TranslationKey, string>

/**
 * F-24: loads a single locale's dictionary on demand.
 *
 * The old lib/translations.ts exported one object containing both `en`
 * and `ar` (~1600 lines, ~94KB combined). Every client bundle that
 * touched translations — which, via LanguageContext, was effectively
 * every page — shipped both locales even though a session only ever
 * renders one at a time.
 *
 * `en` and `ar` now live in their own modules (./en, ./ar). The dynamic
 * `import()` calls below make webpack code-split each into its own
 * chunk, fetched only when this function actually runs.
 *
 * The *initial* locale is deliberately NOT loaded through this function:
 * app/layout.tsx (a Server Component) resolves it from the NEXT_LOCALE
 * cookie and imports just that one dictionary directly, passing it down
 * as a plain serialized prop. That keeps first paint fully synchronous —
 * no client-side fetch, no loading flash — while still ensuring the
 * *other*, unused locale is never part of the initial page load. This
 * function is for what's left: loading the other locale on demand when
 * the user actually toggles it (see context/LanguageContext.tsx).
 */
export async function loadTranslations(locale: Locale): Promise<TranslationDict> {
    if (locale === 'ar') {
        return (await import('./ar')).ar
    }
    return (await import('./en')).en
}
