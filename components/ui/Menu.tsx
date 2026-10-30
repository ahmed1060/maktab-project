'use client'

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { DotsThreeIcon } from '@phosphor-icons/react/ssr'
import { Icon, type PhosphorIcon } from './Icon'
import { cx } from './cx'

export type MenuItem = {
    key: string
    label: string
    icon?: PhosphorIcon
    /** Goes to another page. */
    href?: string
    /** Does something here. A destructive one still asks before it acts. */
    onSelect?: () => void
    /** Delete and the like: shown last, after a hairline, in the danger colour. */
    danger?: boolean
    disabled?: boolean
}

/**
 * The actions on one item that don't fit in its row (DESIGN.md §5.5), behind a
 * quiet "More actions" button.
 *
 * The pop-up is put on the page's body, so the list's panel, which clips its
 * corners, can't cut it off at the last row. It opens on the end side of the
 * button, below it, or above it when there's no room below. The arrow keys
 * move through it, Escape closes it and returns to the button, and Tab, a
 * scroll or a click elsewhere closes it.
 */
/**
 * Whether a scroll or a resize leaves the menu behind: a scroll inside it
 * doesn't. A resize's target is the window, not a node in the page, and
 * contains() throws on it, so it's asked only of a node.
 */
export function movedAway(menu: { contains(node: Node): boolean } | null, target: EventTarget | null): boolean {
    return !(target && 'nodeType' in target && menu?.contains(target as Node))
}

export function RowMenu({ label, items, tooltip }: {
    /** The button's name, saying whose actions they are: "More actions for Sara Hassan". */
    label: string
    items: MenuItem[]
    /** Shown on hover, as the button shows only its icon: "More actions". */
    tooltip: string
}) {
    const [open, setOpen] = useState(false)
    const [place, setPlace] = useState<CSSProperties | null>(null)
    const button = useRef<HTMLButtonElement>(null)
    const menu = useRef<HTMLDivElement>(null)
    const id = useId()

    const ordered = [...items.filter(i => !i.danger), ...items.filter(i => i.danger)]
    const firstDanger = ordered.findIndex(i => i.danger)

    const close = (refocus: boolean) => {
        setOpen(false)
        setPlace(null)
        if (refocus) button.current?.focus()
    }

    // Placed against the button once the list's height is known: below it,
    // or above it when it would run off the bottom of the screen.
    useLayoutEffect(() => {
        if (!open || !button.current || !menu.current) return
        const at = button.current.getBoundingClientRect()
        const height = menu.current.offsetHeight
        const rtl = getComputedStyle(button.current).direction === 'rtl'
        const below = at.bottom + 4 + height <= window.innerHeight || at.top - 4 - height < 0
        setPlace({
            insetInlineEnd: rtl ? at.left : window.innerWidth - at.right,
            ...(below ? { top: at.bottom + 4 } : { bottom: window.innerHeight - at.top + 4 }),
        })
    }, [open])

    useEffect(() => {
        if (!open || !place) return
        menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
    }, [open, place])

    useEffect(() => {
        if (!open) return
        const outside = (e: Event) => {
            const target = e.target as Node
            if (!menu.current?.contains(target) && !button.current?.contains(target)) close(false)
        }
        const scrolled = (e: Event) => { if (movedAway(menu.current, e.target)) close(false) }
        document.addEventListener('pointerdown', outside)
        window.addEventListener('scroll', scrolled, true)
        window.addEventListener('resize', scrolled)
        return () => {
            document.removeEventListener('pointerdown', outside)
            window.removeEventListener('scroll', scrolled, true)
            window.removeEventListener('resize', scrolled)
        }
    }, [open])

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const all = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])]
        const at = all.indexOf(document.activeElement as HTMLElement)
        if (e.key === 'ArrowDown') all[(at + 1) % all.length]?.focus()
        else if (e.key === 'ArrowUp') all[(at - 1 + all.length) % all.length]?.focus()
        else if (e.key === 'Home') all[0]?.focus()
        else if (e.key === 'End') all[all.length - 1]?.focus()
        else if (e.key === 'Escape') close(true)
        else if (e.key === 'Tab') { close(false); return }
        else return
        e.preventDefault()
    }

    const choose = (item: MenuItem) => {
        if (item.disabled) return
        close(!item.href)
        item.onSelect?.()
    }

    return (
        <>
            <button
                ref={button}
                type="button"
                className="ui-btn ui-btn-quiet ui-btn-sm ui-menu-button"
                aria-label={label}
                title={tooltip}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                onClick={() => (open ? close(true) : setOpen(true))}
            >
                <Icon icon={DotsThreeIcon} size={20} weight="bold" />
            </button>
            {open && createPortal(
                <div
                    ref={menu}
                    id={id}
                    role="menu"
                    aria-label={label}
                    className="ui-menu"
                    style={place ?? { visibility: 'hidden', top: 0, insetInlineEnd: 0 }}
                    onKeyDown={onKeyDown}
                >
                    {ordered.map((item, i) => {
                        const names = cx('ui-menu-item', item.danger && 'ui-menu-item-danger')
                        const inside = <>{item.icon && <Icon icon={item.icon} size={16} />}{item.label}</>
                        return (
                            <div key={item.key} role="none">
                                {i === firstDanger && i > 0 && <div role="separator" className="ui-menu-rule" />}
                                {item.href && !item.disabled
                                    ? <Link href={item.href} role="menuitem" tabIndex={-1} className={names} prefetch={false} onClick={() => choose(item)}>{inside}</Link>
                                    : <button type="button" role="menuitem" tabIndex={-1} className={names} aria-disabled={item.disabled || undefined} onClick={() => choose(item)}>{inside}</button>}
                            </div>
                        )
                    })}
                </div>,
                document.body,
            )}
        </>
    )
}
