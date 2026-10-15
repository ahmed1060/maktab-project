import Link from 'next/link'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Icon, type PhosphorIcon } from './Icon'
import { cx } from './cx'

/**
 * Buttons (DESIGN.md §5.2). One primary per area; the rest secondary or
 * quiet; danger only to confirm something destructive. Pill-shaped, 36px on
 * computers (30px in a table row) and 44px on phones.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'

type Look = {
    variant?: ButtonVariant
    size?: 'md' | 'sm'
    /** Goes before the label. The label stays: an icon alone isn't a name. */
    icon?: PhosphorIcon
    children: ReactNode
}

function classes(variant: ButtonVariant, size: 'md' | 'sm', className?: string) {
    return cx('ui-btn', `ui-btn-${variant}`, size === 'sm' && 'ui-btn-sm', className)
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
