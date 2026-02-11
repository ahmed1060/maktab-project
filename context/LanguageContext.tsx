'use client';

import React, { createContext, useContext, useState, useEffect, useTransition } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Locale, TranslationKey, translations } from '@/lib/translations';
import LoadingSpinner from '@/components/LoadingSpinner';

interface LanguageContextType {
    locale: Locale;
    toggleLanguage: () => void;
    t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children, initialLocale }: { children: React.ReactNode, initialLocale: Locale }) {
    const { data: session, status, update } = useSession();
    const router = useRouter();
    const [locale, setLocale] = useState<Locale>(initialLocale);
    const [hasSyncedWithSession, setHasSyncedWithSession] = useState(false);
    const [isChangingLocale, setIsChangingLocale] = useState(false);
    const [, startTransition] = useTransition();

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

            // 4. Update the Client state
            // By doing this inside startTransition, React will wait for the router.refresh()
            // to be partially ready or coordinated before applying the state change.
            setLocale(newLocale);
            document.documentElement.dir = newLocale === 'ar' ? 'rtl' : 'ltr';
            document.documentElement.lang = newLocale;

            // 5. Hide the loading screen after a small buffer to ensure paint completion
            // Note: In Next.js, useTransition's `isPending` might not perfectly 
            // track the RSC payload application, so we use a small timeout for safety.
            setTimeout(() => {
                setIsChangingLocale(false);
            }, 2350);
        });
    };

    const t = (key: TranslationKey): string => {
        const currentTranslations = translations[locale] || translations['en'];
        return currentTranslations[key] || translations['en'][key] || key;
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
