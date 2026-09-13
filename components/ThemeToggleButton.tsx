'use client';

import React from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import { THEMES, type Theme } from '@/lib/theme';

interface ThemeToggleButtonProps {
    variant?: 'fixed' | 'menu-item';
    onAction?: () => void;
}

const ICON: Record<Theme, string> = { light: '☀️', dark: '🌙', system: '💻' };
const LABEL_KEY: Record<Theme, string> = {
    light: 'theme_light',
    dark: 'theme_dark',
    system: 'theme_system',
};

/**
 * Cycles light → dark → system.
 *
 * A cycle rather than a two-way switch because there are three states: a
 * toggle that only flips light and dark makes "follow my operating system"
 * unreachable once you have touched it even once.
 *
 * Deliberately mirrors LanguageToggleButton — same two variants, same mount
 * points, same shape — so the two preferences behave identically and neither
 * has to be learned separately.
 */
export default function ThemeToggleButton({ variant = 'fixed', onAction }: ThemeToggleButtonProps) {
    const { locale, t } = useLanguage();
    const { theme, setTheme } = useTheme();

    const handleToggle = () => {
        const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
        setTheme(next);
        if (onAction) onAction();
    };

    // Names the state it is in, not the one it would move to. A control that
    // says "Dark" while the app is light cannot be read without clicking it.
    const label = t(LABEL_KEY[theme] as any);

    if (variant === 'menu-item') {
        return (
            <button
                onClick={handleToggle}
                aria-label={`${t('theme_label' as any)}: ${label}`}
                style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.6rem 1rem',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                    borderRadius: '0.5rem',
                    transition: 'background 0.2s',
                    fontWeight: '500',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    direction: locale === 'ar' ? 'rtl' : 'ltr'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--glass-card-border)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
                <span style={{ fontSize: '1.1rem' }}>{ICON[theme]}</span>
                {label}
            </button>
        );
    }

    // Fixed variant for the login page. Sits beside the language button rather
    // than on top of it — the offset is what keeps them from overlapping.
    return (
        <button
            onClick={handleToggle}
            aria-label={`${t('theme_label' as any)}: ${label}`}
            style={{
                position: 'fixed',
                bottom: '2rem',
                right: locale === 'en' ? '11.5rem' : 'auto',
                left: locale === 'ar' ? '11.5rem' : 'auto',
                padding: '0.75rem 1.25rem',
                background: 'var(--glass-solid)',
                backdropFilter: 'blur(10px)',
                border: '1px solid var(--glass-card-border)',
                borderRadius: '50px',
                boxShadow: 'var(--glass-shadow)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.9rem',
                fontWeight: '600',
                color: 'var(--text-main)',
                transition: 'all 0.3s ease',
                zIndex: 1000,
                direction: locale === 'ar' ? 'rtl' : 'ltr'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)' }}
        >
            <span style={{ fontSize: '1.2rem' }}>{ICON[theme]}</span>
            {label}
        </button>
    );
}
