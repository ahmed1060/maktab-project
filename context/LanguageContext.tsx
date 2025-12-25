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
    const { data: session, status } = useSession();
    const [locale, setLocale] = useState<Locale>(initialLocale);

    // Sync with session language if available
    useEffect(() => {
        if (session?.user?.language && session.user.language !== locale) {
            setLocale(session.user.language as Locale);
            document.cookie = `NEXT_LOCALE=${session.user.language};path=/;max-age=31536000`;
            document.documentElement.dir = session.user.language === 'ar' ? 'rtl' : 'ltr';
            document.documentElement.lang = session.user.language;
        }
    }, [session?.user?.language]);

    const toggleLanguage = async () => {
        const newLocale = locale === 'en' ? 'ar' : 'en';
        setLocale(newLocale);

        // Update cookie for SSR
        document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000`;

        // Update DOM attributes
        document.documentElement.dir = newLocale === 'ar' ? 'rtl' : 'ltr';
        document.documentElement.lang = newLocale;

        // Background sync if authenticated
        if (status === 'authenticated') {
            try {
                await fetch('/api/user/language', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ language: newLocale }),
                });
            } catch (error) {
                console.error('Failed to sync language preference:', error);
            }
        }

        // Force a page refresh to update server-rendered components with the new locale from cookie
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
