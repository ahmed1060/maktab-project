'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Locale, TranslationKey, translations } from '@/lib/translations';

interface LanguageContextType {
    locale: Locale;
    toggleLanguage: () => void;
    t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children, initialLocale }: { children: React.ReactNode, initialLocale: Locale }) {
    const { data: session, status, update } = useSession();
    const [locale, setLocale] = useState<Locale>(initialLocale);
    const [hasSyncedWithSession, setHasSyncedWithSession] = useState(false);

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

        // 1. Update UI state immediately
        setLocale(newLocale);
        document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000`;
        document.documentElement.dir = newLocale === 'ar' ? 'rtl' : 'ltr';
        document.documentElement.lang = newLocale;

        // 2. Background sync if authenticated
        if (status === 'authenticated') {
            try {
                // Update Database
                await fetch('/api/user/language', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ language: newLocale }),
                });

                // Update Session (JWT) - this prevents the "snap-back" by making the refresh see the new language
                await update({ language: newLocale });
            } catch (error) {
                console.error('Failed to sync language preference:', error);
            }
        }

        // 3. Force a page refresh to update server-rendered components
        window.location.reload();
    };

    const t = (key: TranslationKey): string => {
        return translations[locale][key] || key;
    };

    return (
        <LanguageContext.Provider value={{ locale, toggleLanguage, t }}>
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
