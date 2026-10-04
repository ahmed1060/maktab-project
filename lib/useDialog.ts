'use client'
import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { focusables, trapTab } from '@/lib/focus-trap'

/**
 * What a dialog's panel needs to behave as a dialog (WCAG 2.4.3, 4.1.2;
 * accessibility audit of 4 October 2026, C2). Spread `panelProps` on the
 * panel and put `titleId` on its heading:
 *
 * - it says it is a modal dialog and is named by its title;
 * - focus moves into it on opening (to a field that asked for focus, else
 *   the first thing that can be focused, else the panel);
 * - Tab stays inside it while it's open;
 * - Escape closes it, when `onClose` is given;
 * - focus goes back to whatever opened it when it closes.
 *
 * Before, focus stayed on the page behind, so Tab and screen readers moved
 * through content hidden by the overlay, and closing left focus nowhere.
 */
export function useDialog(isOpen: boolean, onClose?: () => void) {
    const ref = useRef<HTMLDivElement>(null)
    const titleId = useId()
    const close = useRef(onClose)
    useEffect(() => { close.current = onClose })

    useEffect(() => {
        if (!isOpen) return
        const opener = document.activeElement as HTMLElement | null
        // After the panel is drawn (it may be in a portal), and after any
        // autoFocus field inside it has taken focus.
        let panel: HTMLElement | null = null
        const timer = setTimeout(() => {
            panel = ref.current
            if (!panel || panel.contains(document.activeElement)) return
            const target = (focusables(panel)[0] as unknown as HTMLElement | undefined) ?? panel
            target.focus()
        }, 0)
        return () => {
            clearTimeout(timer)
            // Only if focus is still in the dialog or lost: not if the person has moved on.
            const now = document.activeElement
            if (opener && opener.isConnected && (!now || now === document.body || panel?.contains(now) || !now.isConnected)) opener.focus()
        }
    }, [isOpen])

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && close.current) {
            e.stopPropagation()
            close.current()
            return
        }
        trapTab(e, ref.current, document.activeElement)
    }

    return {
        titleId,
        panelProps: {
            ref,
            role: 'dialog' as const,
            'aria-modal': true,
            'aria-labelledby': titleId,
            tabIndex: -1,
            onKeyDown,
        },
    }
}
