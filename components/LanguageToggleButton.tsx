'use client';

import React from 'react';
import { useLanguage } from '@/context/LanguageContext';
import SegmentedToggle from '@/components/SegmentedToggle';
import type { Locale } from '@/lib/translations';

interface LanguageToggleButtonProps {
    /** 'inline' is positioned by whatever holds it — see PreferenceBar. */
    variant?: 'inline' | 'menu-item';
    onAction?: () => void;
}

/**
 * Both languages visible, the current one marked.
 *
 * Was a single button that flipped. With two options that shape has the same
 * problem a self-renaming filter button had: it cannot say which language is on
 * and what clicking would do at the same time, so you find out by clicking.
 *
 * Each option is labelled in its own language rather than translated into the
 * other. Somebody who cannot read the current interface is exactly the person
 * reaching for this control.
 *
 * No pending state of its own: LanguageProvider holds a full-page overlay at
 * z-index 99999 for the whole switch, so anything rendered here would be
 * underneath it. It is disabled during the switch anyway, so the control does
 * not depend on an overlay in another file to stop a second click.
 */
const OPTIONS: { value: Locale; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'ar', label: 'العربية' },
];

export default function LanguageToggleButton({ variant = 'inline', onAction }: LanguageToggleButtonProps) {
    const { locale, setLanguage, isChangingLocale, t } = useLanguage();

    const handleChange = (next: Locale) => {
        setLanguage(next);
        if (onAction) onAction();
    };

    const control = (
        <SegmentedToggle
            value={locale}
            options={OPTIONS}
            onChange={handleChange}
            ariaLabel={t('toggle_language')}
            disabled={isChangingLocale}
            size={variant === 'menu-item' ? 'sm' : 'md'}
            fixedOrder
        />
    );

    if (variant === 'menu-item') {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0.35rem 1rem',
                direction: locale === 'ar' ? 'rtl' : 'ltr',
            }}>
                {control}
            </div>
        );
    }

    return control;
}
