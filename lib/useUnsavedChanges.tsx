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
