'use client';

import React, { createContext, useContext, useState, useEffect, useTransition } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import type { Locale, TranslationKey, TranslationDict } from '@/lib/translations';
import { loadTranslations } from '@/lib/translations';
import LoadingSpinner from '@/components/LoadingSpinner';

interface LanguageContextType {
    locale: Locale;
    /** Pick a language. A no-op when it is already the current one. */
    setLanguage: (next: Locale) => void;
    toggleLanguage: () => void;
    /** True while a switch is in flight — the dictionary for the target locale
     *  may still be loading, and the provider is holding a full-page overlay
     *  over everything including whatever control started it. */
    isChangingLocale: boolean;
    t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children, initialLocale, initialDict }: { children: React.ReactNode, initialLocale: Locale, initialDict: TranslationDict }) {
    const { data: session, status, update } = useSession();
    const router = useRouter();
    const [locale, setLocale] = useState<Locale>(initialLocale);
    const [hasSyncedWithSession, setHasSyncedWithSession] = useState(false);
    const [isChangingLocale, setIsChangingLocale] = useState(false);
    const [, startTransition] = useTransition();

    // F-24: seeded synchronously from the server-resolved initial locale's
    // dictionary (see app/layout.tsx) so first paint never waits on a
    // client-side fetch or shows a loading flash — this is the only
    // dictionary guaranteed present on mount. Every other locale is
    // fetched on demand: once here for a locale switch that bypasses
    // toggleLanguage (the session sync below), and
    // pre-fetched in toggleLanguage itself before it flips `locale`.
    const [dicts, setDicts] = useState<Partial<Record<Locale, TranslationDict>>>({ [initialLocale]: initialDict });

    // Keeps `dicts[locale]` populated if `locale` ever changes through a
    // path other than toggleLanguage (which pre-loads its target locale
    // itself) — i.e. the session sync below, which calls setLocale
    // directly.
    useEffect(() => {
        if (dicts[locale]) return;
        let cancelled = false;
        loadTranslations(locale).then(dict => {
            if (!cancelled) setDicts(prev => (prev[locale] ? prev : { ...prev, [locale]: dict }));
        });
        return () => { cancelled = true };
    }, [locale, dicts]);

    // A signed-in account's language wins over the cookie, once, on sign-in or
    // first load. Adjusted during render rather than in an effect, which
    // painted the cookie's language first and then switched.
    const sessionLang = status === 'authenticated' ? (session?.user?.language as Locale | undefined) : undefined;
    if (sessionLang && !hasSyncedWithSession) {
        setHasSyncedWithSession(true);
        if (sessionLang !== locale) setLocale(sessionLang);
    }

    // The document and the cookie follow whatever the locale ended up being.
    // On first load this also writes the cookie for a browser that had none:
    // the server picked the language from Accept-Language (lib/locale.ts), and
    // the cookie keeps that choice fixed from here on.
    useEffect(() => {
        document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=31536000`;
        document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
        document.documentElement.lang = locale;
    }, [locale]);

    // Takes the locale to move to rather than flipping, because the control
    // that calls it is a two-option picker: clicking the half you are already
    // on should do nothing, not swap you to the other one.
    const setLanguage = async (newLocale: Locale) => {
        if (newLocale === locale || isChangingLocale) return;
        setIsChangingLocale(true);

        // F-24: kick off loading the target locale's dictionary (if it
        // isn't already cached from a previous toggle) in parallel with
        // everything below, but only flip `locale` once it resolves — see
        // the .then() a few lines down. Without this, `locale` could
        // update before its dictionary exists, and t() would fall through
        // to the initial locale via `dicts[locale] || dicts[initialLocale]`
        // for a brief flash instead of showing a stale-but-real page under
        // the loading overlay.
        const dictPromise = dicts[newLocale] ? Promise.resolve(dicts[newLocale]!) : loadTranslations(newLocale);

        // 1. Update the cookie immediately on the client side
        // This is necessary so that the router.refresh() (the GET request)
        // will carry the correct locale to the server.
        document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000`;

        // 2. Start a transition to handle the server-side refresh and client-side toggle together
        startTransition(() => {
            // A. Trigger server-side refresh (fetches fresh RSC payload with the new cookie)
            router.refresh();

            // 3. Background sync if authenticated
            if (status === 'authenticated') {
                Promise.all([
                    fetch('/api/user/language', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ language: newLocale }),
                    }),
                    update({ language: newLocale })
                ]).catch(console.error);
            }

            // 4. Update the Client state once the new locale's dictionary
            // has actually arrived.
            dictPromise.then(dict => {
                setDicts(prev => (prev[newLocale] ? prev : { ...prev, [newLocale]: dict }));
                setLocale(newLocale);
            });

            // 5. Hide the loading screen after a small buffer to ensure paint completion
            // Note: In Next.js, useTransition's `isPending` might not perfectly
            // track the RSC payload application, so we use a small timeout for safety.
            setTimeout(() => {
                setIsChangingLocale(false);
            }, 2350);
        });
    };

    const t = (key: TranslationKey): string => {
        const currentDict = dicts[locale] || dicts[initialLocale];
        // Falling back to the raw key here used to make every `t(key) ||
        // 'fallback'` call site in the app dead code — that `||` can never
        // fire, since a missing key returned the (truthy) key string
        // itself instead of something falsy. '' lets real fallbacks work,
        // present and future, instead of leaking a raw snake_case key to
        // the user.
        return currentDict?.[key] || dicts.en?.[key] || '';
    };

    const toggleLanguage = () => setLanguage(locale === 'en' ? 'ar' : 'en');

    return (
        <LanguageContext.Provider value={{ locale, setLanguage, toggleLanguage, isChangingLocale, t }}>
            {isChangingLocale && <LoadingSpinner fullPage />}
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (context === undefined) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
}
