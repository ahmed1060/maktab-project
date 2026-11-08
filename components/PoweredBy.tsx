'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { DEFAULT_POWERED_BY_NAME } from '@/lib/branding-defaults'

/**
 * The "Powered by" signature, kept as it is (DESIGN.md §5.1): floating in the
 * corner on a computer, at the end of the page on a phone, its look in
 * app/globals.css (.floating-attribution). The dashboard draws it, and the
 * sign-in page too (decided 2026-11-08). Where it's switched off in System
 * settings it isn't drawn at all, not merely made transparent: an invisible
 * element still takes a corner of the screen and still reads out to a screen
 * reader. The name is left as it is by a browser's translation, as its
 * preview on System settings leaves it.
 */
export function PoweredBy({ name }: { name?: string | null }) {
    const { t } = useLanguage()
    return (
        <div className="floating-attribution">
            <span className="floating-attribution-by">{t('powered_by')}</span>
            <span className="floating-attribution-name" translate="no">{name?.trim() || DEFAULT_POWERED_BY_NAME}</span>
        </div>
    )
}

type SignatureSetting = { show: boolean; name?: string | null }

// System settings' switch and name, from the sign-in pages' layout, which
// reads them, to the sign-in screen, which draws it. Off where nothing says.
const Setting = createContext<SignatureSetting>({ show: false })

export function SignatureSettingProvider({ show, name, children }: SignatureSetting & { children: ReactNode }) {
    return <Setting.Provider value={{ show, name }}>{children}</Setting.Provider>
}

/** The sign-in page's signature, as System settings has it (DESIGN.md §5.5, Sign-in). */
export function SignInSignature() {
    const { show, name } = useContext(Setting)
    return show ? <PoweredBy name={name} /> : null
}
