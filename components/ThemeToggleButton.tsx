'use client';

import React from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import SegmentedToggle from '@/components/SegmentedToggle';
import { type Theme } from '@/lib/theme';

interface ThemeToggleButtonProps {
    /** 'inline' is positioned by whatever holds it — see PreferenceBar. */
    variant?: 'inline' | 'menu-item';
    onAction?: () => void;
}

const ICON: Record<Theme, string> = { light: '☀️', dark: '🌙' };
const LABEL_KEY: Record<Theme, string> = { light: 'theme_light', dark: 'theme_dark' };
const ORDER: Theme[] = ['light', 'dark'];

/**
 * Both themes visible, the current one marked.
 *
 * Was a cycle through light → dark → system, which had to name the state it was
 * in and so could never say what clicking would do. With "system" gone there
 * are two options, and a segmented control shows both at once.
 *
 * Deliberately the same control as the language picker, mounted in the same two
 * places — so a person learns one and has learned both.
 *
 * Order is *not* pinned here, unlike the language picker. Light and dark have
 * no side of their own to belong on; the language control is about language
 * rather than in one, which is the whole reason that one is exempt.
 */
export default function ThemeToggleButton({ variant = 'inline', onAction }: ThemeToggleButtonProps) {
    const { locale, t } = useLanguage();
    const { theme, setTheme } = useTheme();

    const handleChange = (next: Theme) => {
        setTheme(next);
        if (onAction) onAction();
    };

    const control = (
        <SegmentedToggle
            value={theme}
            options={ORDER.map(value => ({ value, label: `${ICON[value]} ${t(LABEL_KEY[value] as any)}` }))}
            onChange={handleChange}
            ariaLabel={t('theme_label' as any)}
            size={variant === 'menu-item' ? 'sm' : 'md'}
        />
    );

    if (variant === 'menu-item') {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.6rem',
                padding: '0.5rem 1rem',
                direction: locale === 'ar' ? 'rtl' : 'ltr',
            }}>
                <span style={{ fontSize: '1.1rem' }}>🎨</span>
                {control}
            </div>
        );
    }

    return control;
}
