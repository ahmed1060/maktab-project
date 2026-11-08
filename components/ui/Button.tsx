import Link from 'next/link'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
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
 * A button's look and nothing else, for a preview such as the Brand colour
 * card's: no one can press it or reach it with Tab.
 */
export function ButtonLook({ variant = 'secondary', size = 'md', children }: Omit<Look, 'icon'>) {
    return <span className={classes(variant, size)}>{children}</span>
}
