'use client'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { dialogKeyDown, focusables } from '@/lib/focus-trap'

/**
 * What a dialog's panel needs to behave as a dialog (WCAG 2.4.3, 4.1.2;
 * accessibility audit of 4 October 2026, C2). Spread `panelProps` on the
 * panel and put `titleId` on its heading (or pass `label` if it has none):
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
export function useDialog(isOpen: boolean, onClose?: () => void, opts: { label?: string } = {}) {
    const ref = useRef<HTMLDivElement>(null)
    const titleId = useId()
    const close = useRef(onClose)
    useEffect(() => { close.current = onClose })

    // What had focus while the dialog was closed: what opened it. Read on
    // opening would be too late when a field in the dialog has autoFocus,
    // which takes focus before effects run.
    const lastOutside = useRef<HTMLElement | null>(null)
    useEffect(() => {
        if (isOpen) return
        lastOutside.current = document.activeElement as HTMLElement | null
        const onFocus = (e: FocusEvent) => {
            const target = e.target as HTMLElement
            // Not a field of this dialog taking focus as it opens.
            if (target.closest?.(`[data-dialog="${CSS.escape(titleId)}"]`)) return
            lastOutside.current = target
        }
        document.addEventListener('focusin', onFocus)
        return () => document.removeEventListener('focusin', onFocus)
    }, [isOpen, titleId])

    // Drawn already open (shown by its parent rather than toggled, as the
    // flagged face check and the attendance editors are): what had focus as
    // it was first drawn opened it. Read while rendering, before an autoFocus
    // field inside takes focus; the effect above never ran closed, so it read
    // nothing, and closing left focus on the page (Codex review of #36).
    const [focusedAtMount] = useState(() => (typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null))

    useEffect(() => {
        if (!isOpen) return
        const opener = lastOutside.current ?? (focusedAtMount === document.body ? null : focusedAtMount)
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
    }, [isOpen, focusedAtMount])

    const onKeyDown = (e: KeyboardEvent) => {
        dialogKeyDown(e, ref.current, document.activeElement, close.current)
    }

    return {
        titleId,
        panelProps: {
            ref,
            role: 'dialog' as const,
            'data-dialog': titleId,
            'aria-modal': true,
            // Named by its heading, or by `label` when it has none on screen.
            ...(opts.label ? { 'aria-label': opts.label } : { 'aria-labelledby': titleId }),
            tabIndex: -1,
            onKeyDown,
        },
    }
}
