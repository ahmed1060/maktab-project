'use client'

import { createPortal } from 'react-dom'
import { useState, type ReactNode } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useDialog } from '@/lib/useDialog'
import { useHydrated } from '@/lib/useHydrated'
import { Button } from './Button'

/**
 * A dialog (DESIGN.md §5.5): a level-2 panel over the dimmed page, with its
 * title, what it asks, and its buttons at the bottom on the end side, the main
 * one last. useDialog keeps focus inside it, closes it on Escape and gives
 * focus back to what opened it.
 *
 * A dialog that is a form puts its buttons in DialogActions inside the form,
 * so Enter and the submit button are the form's.
 *
 * One that can open from an older page's modal (components/Modal), which sits
 * above the building blocks, says so, to sit above it in turn.
 */
export function Dialog({ open, onClose, title, children, actions, overModal = false }: {
    open: boolean
    onClose: () => void
    title: ReactNode
    children: ReactNode
    actions?: ReactNode
    overModal?: boolean
}) {
    const dialog = useDialog(open, onClose)
    const mounted = useHydrated()
    if (!open || !mounted) return null
    return createPortal(
        <div className={overModal ? 'ui-dialog-backdrop is-over-modal' : 'ui-dialog-backdrop'}>
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

/**
 * Asks before an action (DESIGN.md §5.5, Dialog): what it does, Cancel, and
 * the button that does it, the main one last, in the danger colour only when
 * it deletes or can't be undone.
 *
 * onConfirm hands back the work, and the dialog stays open and busy until it
 * settles: Cancel off, the main button turning, Escape and a click outside it
 * ignored, since what was sent can't be called off. Close it once the work is
 * done, not before. It was the old confirmation window, of its own making
 * (PR 189).
 */
export function ConfirmDialog({ open, title, body, confirmLabel, danger = false, onConfirm, onCancel, overModal = false }: {
    open: boolean
    title: ReactNode
    /** What it does, in a sentence or two. */
    body: ReactNode
    /** What the main button does, as the action's own button says it. */
    confirmLabel: ReactNode
    /** It deletes something, or can't be undone. */
    danger?: boolean
    onConfirm: () => unknown
    onCancel: () => void
    /** It opens from an older page's modal, and sits above it. */
    overModal?: boolean
}) {
    const { t } = useLanguage()
    const [working, setWorking] = useState(false)
    // Each time it opens, from nothing: a confirmation never carries over.
    useAdjustOnChange([open], () => setWorking(false))

    const cancel = () => { if (!working) onCancel() }
    const confirm = () => {
        if (working) return
        const work = onConfirm()
        if (!work || typeof (work as Promise<unknown>).then !== 'function') return
        setWorking(true)
        ;(work as Promise<unknown>)
            .catch(error => console.error(error))
            .finally(() => setWorking(false))
    }

    return (
        <Dialog open={open} onClose={cancel} title={title} overModal={overModal} actions={<>
            <Button onClick={cancel} disabled={working}>{t('cancel')}</Button>
            <Button variant={danger ? 'danger' : 'primary'} busy={working} onClick={confirm}>{confirmLabel}</Button>
        </>}>
            <p>{body}</p>
        </Dialog>
    )
}
