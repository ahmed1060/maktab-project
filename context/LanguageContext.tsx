'use client';

import React, { createContext, useContext, useState, useEffect, useTransition } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import type { Locale, TranslationKey, TranslationDict } from '@/lib/translations';
import { loadTranslations } from '@/lib/translations';
import LoadingSpinner from '@/components/LoadingSpinner';

interface LanguageContextType {
    locale: Locale;
    toggleLanguage: () => void;
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
    // toggleLanguage (the detection/session-sync effects below), and
    // pre-fetched in toggleLanguage itself before it flips `locale`.
    const [dicts, setDicts] = useState<Partial<Record<Locale, TranslationDict>>>({ [initialLocale]: initialDict });

    // Keeps `dicts[locale]` populated if `locale` ever changes through a
    // path other than toggleLanguage (which pre-loads its target locale
    // itself) — e.g. the browser-language detection and session-sync
    // effects below both call setLocale directly.
    useEffect(() => {
        if (dicts[locale]) return;
        let cancelled = false;
        loadTranslations(locale).then(dict => {
            if (!cancelled) setDicts(prev => (prev[locale] ? prev : { ...prev, [locale]: dict }));
        });
        return () => { cancelled = true };
    }, [locale, dicts]);

    // Initial language detection
    useEffect(() => {
        const storedLocale = document.cookie.split('; ').find(row => row.startsWith('NEXT_LOCALE='))?.split('=')[1];

        if (!storedLocale) {
            // No cookie? Check browser language
            const browserLang = navigator.language.split('-')[0];
            const detectedLocale = browserLang === 'ar' ? 'ar' : 'en';

            // Apply it only if we haven't already set a locale
            if (locale !== detectedLocale) {
                setLocale(detectedLocale as Locale);
                document.cookie = `NEXT_LOCALE=${detectedLocale};path=/;max-age=31536000`;
                document.documentElement.dir = detectedLocale === 'ar' ? 'rtl' : 'ltr';
                document.documentElement.lang = detectedLocale;
            }
        }
    }, []);

    // Sync with session language ONLY ONCE on login or mount
    useEffect(() => {
        if (status === 'authenticated' && session?.user?.language && !hasSyncedWithSession) {
            const sessionLang = session.user.language as Locale;
            if (sessionLang !== locale) {
                setLocale(sessionLang);
                document.cookie = `NEXT_LOCALE=${sessionLang};path=/;max-age=31536000`;
                document.documentElement.dir = sessionLang === 'ar' ? 'rtl' : 'ltr';
                document.documentElement.lang = sessionLang;
            }
            setHasSyncedWithSession(true);
        }
    }, [status, session?.user?.language, hasSyncedWithSession, locale]);

    const toggleLanguage = async () => {
        const newLocale = locale === 'en' ? 'ar' : 'en';
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
                document.documentElement.dir = newLocale === 'ar' ? 'rtl' : 'ltr';
                document.documentElement.lang = newLocale;
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

    return (
        <LanguageContext.Provider value={{ locale, toggleLanguage, t }}>
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
