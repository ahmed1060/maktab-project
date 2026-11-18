import Link from 'next/link'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { InfoIcon } from '@phosphor-icons/react/ssr'
import { Icon, type PhosphorIcon } from './Icon'
import { cx } from './cx'

/**
 * Buttons (DESIGN.md §5.2). One primary per area; the rest secondary or
 * quiet; danger only to confirm something destructive. Pill-shaped, 36px on
 * computers (30px in a table row) and 44px on phones; large, 56px, only for
 * the check-in page's Check in and Check out.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'

type Look = {
    variant?: ButtonVariant
    size?: 'md' | 'sm' | 'lg'
    /** Goes before the label. The label stays: an icon alone isn't a name. */
    icon?: PhosphorIcon
    children: ReactNode
}

function classes(variant: ButtonVariant, size: 'md' | 'sm' | 'lg', className?: string) {
    return cx('ui-btn', `ui-btn-${variant}`, size === 'sm' && 'ui-btn-sm', size === 'lg' && 'ui-btn-lg', className)
}

export function Button({ variant = 'secondary', size = 'md', icon, busy = false, className, children, disabled, type = 'button', ...rest }:
    Look & { busy?: boolean } & Omit<ComponentPropsWithoutRef<'button'>, 'children'>) {
    return (
        <button type={type} className={classes(variant, size, className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
            {icon && <Icon icon={icon} size={size === 'sm' ? 16 : 18} />}
            {children}
        </button>
    )
}

/**
 * A guide's button (DESIGN.md §5.2, PR 282): a round quiet "i" right after a
 * card's title, where what the card is for is done mostly away from Nizmo.
 * Named for the guide it opens, in its tooltip too; it opens the guide and
 * does nothing else.
 */
export function GuideButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button type="button" className="ui-btn ui-btn-quiet ui-btn-sm ui-guide-button" aria-label={label} title={label} aria-haspopup="dialog" onClick={onClick}>
            <Icon icon={InfoIcon} size={18} />
        </button>
    )
}

/** A link that looks like a button, for actions that go to another page. */
export function ButtonLink({ variant = 'secondary', size = 'md', icon, className, children, href, ...rest }:
    Look & { href: string } & Omit<ComponentPropsWithoutRef<typeof Link>, 'href' | 'children'>) {
    return (
        <Link href={href} className={classes(variant, size, className)} {...rest}>
            {icon && <Icon icon={icon} size={size === 'sm' ? 16 : 18} />}
            {children}
        </Link>
    )
}

/**
 * A file to download, such as the Roles card's Export: a plain link, which
 * the browser fetches itself, where the app's own would fetch it as a page.
 */
export function ButtonDownload({ variant = 'secondary', size = 'md', icon, className, children, href }: Look & { href: string; className?: string }) {
    return (
        <a className={classes(variant, size, className)} href={href} download>
            {icon && <Icon icon={icon} size={size === 'sm' ? 16 : 18} />}
            {children}
        </a>
    )
}

/**
 * A bookmark to drag to the browser's bookmarks bar (DESIGN.md §5.5, The tax
 * portal's export button; PR 319): a link that looks like a button, with the
 * hand that says it's dragged. Its address is a `javascript:` one, which
 * React doesn't draw, so it's put on the link once that's on the page.
 * Pressed, it goes nowhere: `onPress` says what it's for.
 */
export function ButtonBookmark({ address, icon, describedBy, onPress, children }:
    Pick<Look, 'icon' | 'children'> & { address: string; describedBy?: string; onPress: () => void }) {
    return (
        <a
            ref={link => { link?.setAttribute('href', address) }}
            className={classes('secondary', 'md', 'ui-btn-bookmark')}
            aria-describedby={describedBy}
            onClick={event => { event.preventDefault(); onPress() }}
        >
            {icon && <Icon icon={icon} size={18} />}
            {children}
        </a>
    )
}

/**
 * A button's look and nothing else, for a preview such as the Brand colour
 * card's: no one can press it or reach it with Tab.
 */
export function ButtonLook({ variant = 'secondary', size = 'md', children }: Omit<Look, 'icon'>) {
    return <span className={classes(variant, size)}>{children}</span>
}
