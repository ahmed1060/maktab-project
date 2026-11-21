'use client'

import { useLanguage } from '@/context/LanguageContext'
import { classes, type Look } from './Button'
import { Icon } from './Icon'

/**
 * A link that looks like a button, to another site, such as Contact on
 * WhatsApp's Open WhatsApp (DESIGN.md §5.5; PR 344), or to a page meant for a
 * tab of its own, such as the tax position statement (PR 352). It opens in a new tab,
 * which it says to screen readers, with nothing of this page passed on to
 * the site. A press is handed on, so a dialog it's in can close as the tab
 * opens. In a file of its own, as it reads the page's language: `Button.tsx`
 * is drawn on the server too.
 */
export function ButtonExternal({ variant = 'secondary', size = 'md', icon, className, children, href, onClick }:
    Look & { href: string; className?: string; onClick?: () => void }) {
    const { t } = useLanguage()
    return (
        <a className={classes(variant, size, className)} href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
            {icon && <Icon icon={icon} size={size === 'sm' ? 16 : 18} />}
            {children}
            <span className="ui-visually-hidden">{` ${t('ui_opens_new_tab')}`}</span>
        </a>
    )
}
