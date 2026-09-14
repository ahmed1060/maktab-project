'use client'

import { useLanguage } from '@/context/LanguageContext'
import LanguageToggleButton from '@/components/LanguageToggleButton'
import ThemeToggleButton from '@/components/ThemeToggleButton'

/**
 * Language and theme, pinned to the corner of a page with no session.
 *
 * One flex row rather than two independently positioned elements. The two
 * controls used to place themselves — `right: 2rem` and `right: 11.5rem`, each
 * with an RTL mirror — which means the second offset is a hand-measurement of
 * the first control's width, and has to be re-derived whenever either one
 * changes size. The language control just became a segmented toggle, which is
 * wider than the pill it replaced, so that measurement was already wrong.
 *
 * The row also wraps, which two fixed elements could not: on a narrow phone in
 * Arabic the two controls together are wider than the screen.
 */
export default function PreferenceBar() {
    const { locale } = useLanguage()
    const isRtl = locale === 'ar'

    return (
        <div
            style={{
                position: 'fixed',
                bottom: '2rem',
                // Anchored to the reading-end corner, which is where a control
                // you are not looking for belongs in each direction.
                [isRtl ? 'left' : 'right']: '2rem',
                [isRtl ? 'right' : 'left']: 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: isRtl ? 'flex-start' : 'flex-end',
                flexWrap: 'wrap',
                gap: '0.75rem',
                maxWidth: 'calc(100vw - 4rem)',
                zIndex: 1000,
                direction: isRtl ? 'rtl' : 'ltr',
            }}
        >
            <ThemeToggleButton variant="inline" />
            <LanguageToggleButton variant="inline" />
        </div>
    )
}
