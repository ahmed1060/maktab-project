'use client'

import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { useDialog } from '@/lib/useDialog'
import { useHydrated } from '@/lib/useHydrated'

/**
 * A dialog (DESIGN.md §5.5): a level-2 panel over the dimmed page, with its
 * title, what it asks, and its buttons at the bottom on the end side, the main
 * one last. useDialog keeps focus inside it, closes it on Escape and gives
 * focus back to what opened it.
 *
 * A dialog that is a form puts its buttons in DialogActions inside the form,
 * so Enter and the submit button are the form's.
 */
export function Dialog({ open, onClose, title, children, actions }: {
    open: boolean
    onClose: () => void
    title: ReactNode
    children: ReactNode
    actions?: ReactNode
}) {
    const dialog = useDialog(open, onClose)
    const mounted = useHydrated()
    if (!open || !mounted) return null
    return createPortal(
        <div className="ui-dialog-backdrop">
            <div {...dialog.panelProps} className="ui-dialog">
                <h2 id={dialog.titleId} className="ui-dialog-title">{title}</h2>
                <div className="ui-dialog-body">{children}</div>
                {actions && <DialogActions>{actions}</DialogActions>}
            </div>
        </div>,
        document.body,
    )
}

/** A dialog's buttons: Cancel first, the main one last. */
export function DialogActions({ children }: { children: ReactNode }) {
    return <div className="ui-dialog-actions">{children}</div>
}
