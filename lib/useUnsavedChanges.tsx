'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Unsaved edits on a page made of several forms (the company settings tabs).
 * Each form says whether it holds edits; the page asks before leaving them.
 * Outside a provider, reporting does nothing.
 */

type Guard = { report: (id: string, dirty: boolean) => void }

const UnsavedContext = createContext<Guard | null>(null)

export function UnsavedChangesProvider({ children, onChange }: { children: React.ReactNode; onChange: (dirty: boolean) => void }) {
    const dirty = useRef(new Set<string>())
    const report = useCallback((id: string, isDirty: boolean) => {
        const before = dirty.current.size > 0
        if (isDirty) dirty.current.add(id)
        else dirty.current.delete(id)
        const after = dirty.current.size > 0
        if (before !== after) onChange(after)
    }, [onChange])
    const value = useMemo(() => ({ report }), [report])
    return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>
}

/** Tell the page whether this form holds unsaved edits. Cleared when the form goes away. */
export function useReportUnsaved(id: string, dirty: boolean) {
    const guard = useContext(UnsavedContext)
    useEffect(() => {
        guard?.report(id, dirty)
    }, [guard, id, dirty])
    useEffect(() => () => guard?.report(id, false), [guard, id])
}

/**
 * The in-app address a click would leave for, when it is one to ask about:
 * a plain left click on a link to another page of this site. Not a new tab or
 * window, a download, or a link to where one already is (a hash, the same
 * address), which leave nothing behind.
 */
export function leavingHref(
    link: { href: string; target?: string; download?: boolean } | null,
    click: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean },
    here: string,
): string | null {
    if (!link || click.defaultPrevented || click.button !== 0) return null
    if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null
    if ((link.target && link.target !== '_self') || link.download) return null
    const to = new URL(link.href, here), from = new URL(here)
    if (to.origin !== from.origin) return null
    if (to.pathname === from.pathname && to.search === from.search) return null
    return to.pathname + to.search + to.hash
}

/**
 * While there are unsaved edits, a click on an in-app link (the sidebar, a
 * back link) asks first instead of leaving: `onLeave` gets where it was going.
 * Client-side navigation fires no beforeunload, so without this it would drop
 * the edits silently.
 *
 * Listens on the window in the capture phase, so it comes before anything
 * else: the top progress bar's listener on the document sees the click as
 * prevented and doesn't start. Only prevented, not stopped: the link's own
 * click still runs, so a sidebar link still closes the sidebar on a phone,
 * and Next's Link sees it prevented and doesn't navigate (review on #5).
 */
export function useGuardLinks(dirty: boolean, onLeave: (href: string) => void) {
    const leave = useRef(onLeave)
    useEffect(() => { leave.current = onLeave })
    useEffect(() => {
        if (!dirty) return
        const onClick = (e: MouseEvent) => {
            const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
            const href = leavingHref(a && { href: a.href, target: a.target, download: a.hasAttribute('download') }, e, window.location.href)
            if (!href) return
            e.preventDefault()
            leave.current(href)
        }
        window.addEventListener('click', onClick, true)
        return () => window.removeEventListener('click', onClick, true)
    }, [dirty])
}

/** Whether any form holds edits, and the browser's own prompt on leaving the page while one does. */
export function useUnsavedState() {
    const [dirty, setDirty] = useState(false)
    useEffect(() => {
        if (!dirty) return
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [dirty])
    return { dirty, setDirty }
}
