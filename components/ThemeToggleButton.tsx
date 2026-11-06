'use client';

import { useId } from 'react';
import { MoonIcon, SunIcon } from '@phosphor-icons/react/ssr';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import { Segmented, type SegmentedOption } from '@/components/ui';
import { type Theme } from '@/lib/theme';

interface ThemeToggleButtonProps {
    /** 'menu-item': a row of the account menu, named by its visible label (DESIGN.md §5.1). */
    variant?: 'inline' | 'menu-item';
    onAction?: () => void;
}

/**
 * Both themes visible, the one in use marked: the same switch as the
 * language's, in the account menu and under the sign-in card, so a person
 * learns one and has learned both (DESIGN.md §5.1).
 *
 * Its order isn't pinned, unlike the language switch's: light and dark have
 * no side of their own, so they follow the page's.
 */
export default function ThemeToggleButton({ variant = 'inline', onAction }: ThemeToggleButtonProps) {
    const { t } = useLanguage();
    const { theme, setTheme } = useTheme();
    const labelId = useId();

    const handleChange = (next: Theme) => {
        setTheme(next);
        if (onAction) onAction();
    };

    const options: SegmentedOption<Theme>[] = [
        { value: 'light', label: t('theme_light'), icon: SunIcon },
        { value: 'dark', label: t('theme_dark'), icon: MoonIcon },
    ];

    if (variant === 'menu-item') {
        return (
            <div className="ui-account-theme">
                <span id={labelId} className="ui-account-theme-label">{t('theme_label')}</span>
                <Segmented value={theme} options={options} onChange={handleChange} labelledBy={labelId} />
            </div>
        );
    }

    return <Segmented value={theme} options={options} onChange={handleChange} label={t('theme_label')} />;
}
