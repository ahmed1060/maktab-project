'use client';

import { useLanguage } from '@/context/LanguageContext';
import { Segmented, type SegmentedOption } from '@/components/ui';
import type { Locale } from '@/lib/translations';

interface LanguageToggleButtonProps {
    onAction?: () => void;
}

/**
 * Both languages visible, the one in use marked (DESIGN.md §5.1): on the top
 * bar, and under the sign-in card.
 *
 * Each option is written in its own language rather than translated into the
 * other: somebody who can't read the interface in use is exactly the person
 * reaching for this switch. On a phone's top bar they're EN and ع, still named
 * in full. English stays first in Arabic too, as the switch is about language
 * rather than in one.
 *
 * No pending state of its own: LanguageProvider holds a full-page overlay at
 * z-index 99999 for the whole switch, so anything drawn here would be under
 * it. It's disabled during the switch anyway, so a second click can't depend
 * on an overlay in another file.
 */
const OPTIONS: SegmentedOption<Locale>[] = [
    { value: 'en', label: 'English', short: 'EN', lang: 'en' },
    { value: 'ar', label: 'العربية', short: 'ع', lang: 'ar' },
];

export default function LanguageToggleButton({ onAction }: LanguageToggleButtonProps) {
    const { locale, setLanguage, isChangingLocale, t } = useLanguage();

    const handleChange = (next: Locale) => {
        setLanguage(next);
        if (onAction) onAction();
    };

    return <Segmented value={locale} options={OPTIONS} onChange={handleChange} label={t('language')} disabled={isChangingLocale} fixedOrder />;
}
