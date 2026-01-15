'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
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

        try {
            // 1. Update UI state and Cookies immediately (Optimistic UI)
            setLocale(newLocale);
            document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000`;
            document.documentElement.dir = newLocale === 'ar' ? 'rtl' : 'ltr';
            document.documentElement.lang = newLocale;

            // 2. Background sync if authenticated
            if (status === 'authenticated') {
                // We run database update and session update
                // We don't necessarily need to await them before refreshing the UI,
                // but awaiting ensures the server components see the change.
                await Promise.all([
                    fetch('/api/user/language', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ language: newLocale }),
                    }),
                    update({ language: newLocale })
                ]);
            }

            // 3. Refresh server components WITHOUT a full page white-screen reload
            router.refresh();

            // Increase buffer to 1000ms to ensure server components have time to re-render
            // specifically for the dashboard cards and headers.
            setTimeout(() => {
                setIsChangingLocale(false);
            }, 1000);

        } catch (error) {
            console.error('Failed to switch language:', error);
            setIsChangingLocale(false);
            // Fallback to reload if something goes wrong
            window.location.reload();
        }
    };

    const t = (key: TranslationKey): string => {
        return translations[locale][key] || key;
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
