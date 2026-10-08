'use client'

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { useHydrated } from '@/lib/useHydrated'
import { useLanguage } from '@/context/LanguageContext'

type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
    id: string
    message: string
    type: ToastType
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

/**
 * How long a toast stays up, or null for an error, which has no clock: it may
 * say what to fix, and no clock suits everyone reading it, a screen reader's
 * virtual cursor among them, which moves neither pointer nor focus (WCAG
 * 2.2.1; accessibility audit of 4 October 2026, M1; review on #49). It goes
 * instead once the person moves on (afterMovingOn). The others go after five
 * seconds of not being looked at: the clock stops while the pointer, a finger
 * or focus is on the toast.
 */
export function toastLifetime(type: ToastType): number | null {
    return type === 'error' ? null : 5000
}

/**
 * The toasts left once the person moves on: a tap or click anywhere but on a
 * toast, or another page. Errors go then. They used to stay until their ✕
 * was found, over a phone's buttons; the tap that does something else now
 * takes them away. The others keep their own clock.
 */
export function afterMovingOn(list: Toast[]): Toast[] {
    return list.some(t => t.type === 'error') ? list.filter(t => t.type !== 'error') : list
}

/** At most this many toasts show at once; the oldest goes first. */
export const MAX_TOASTS = 5

/**
 * The list with a new toast added. The same message of the same kind
 * replaces the one already showing (a retried action that fails again
 * doesn't stack copies), and the list keeps only the newest MAX_TOASTS:
 * errors stay until the person moves on, so without a limit a burst of them
 * piled up past the bottom of the screen (Codex review on #37).
 */
export function withToast(list: Toast[], toast: Toast): Toast[] {
    const rest = list.filter(t => !(t.type === toast.type && t.message === toast.message))
    return [...rest, toast].slice(-MAX_TOASTS)
}

/** One toast: its own clock, paused while hovered or focused. */
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
    const { t } = useLanguage()
    const lifetime = toastLifetime(toast.type)
    // Pointer and focus each hold the clock; it runs again only when neither
    // is on the toast (leaving with one shouldn't restart it while the other
    // stays: Codex review on #37).
    const [hovered, setHovered] = useState(false)
    const [focused, setFocused] = useState(false)
    const paused = hovered || focused
    const remaining = useRef(lifetime ?? 0)
    useEffect(() => {
        if (lifetime === null || paused) return
        const started = Date.now()
        const timer = setTimeout(() => onDismiss(toast.id), remaining.current)
        return () => {
            clearTimeout(timer)
            remaining.current = Math.max(0, remaining.current - (Date.now() - started))
        }
    }, [lifetime, paused, onDismiss, toast.id])

    return (
        <div
            // Pointer events: a finger on a phone holds the clock as a mouse does.
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            // Only when focus leaves the toast, not when it moves within it.
            onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false) }}
            style={{
                background: 'white',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                padding: '16px',
                borderLeft: `4px solid ${toast.type === 'success' ? '#22c55e' :
                    toast.type === 'error' ? '#ef4444' :
                        toast.type === 'warning' ? '#f59e0b' : '#3b82f6'
                    }`,
                minWidth: '300px',
                maxWidth: '400px',
                pointerEvents: 'auto', // Re-enable clicks
                animation: 'slideInRight 0.3s ease-out',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'start',
                gap: '12px'
            }}
        >
            <div style={{ color: '#1e293b', fontSize: '0.9rem', lineHeight: '1.5' }}>
                {toast.message}
            </div>
            <button
                type="button"
                aria-label={t('close')}
                onClick={() => onDismiss(toast.id)}
                style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#64748b',
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                    lineHeight: '1',
                    padding: '0'
                }}
            >
                <span aria-hidden="true">&times;</span>
            </button>
        </div>
    )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])
    const mounted = useHydrated()

    const showToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = Math.random().toString(36).substring(2, 9)
        setToasts(prev => withToast(prev, { id, message, type }))
    }, [])

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id))
    }, [])

    // Errors go once the person moves on (afterMovingOn): another page, noticed while rendering, as React
    // asks for state that follows a value...
    const pathname = usePathname()
    const [page, setPage] = useState(pathname)
    if (page !== pathname) {
        setPage(pathname)
        setToasts(afterMovingOn)
    }
    // ...or a tap or click anywhere but on a toast. Listened for only while an error shows, and from the
    // next one on: the tap that led to the error came before it.
    const region = useRef<HTMLDivElement>(null)
    const showingError = toasts.some(t => t.type === 'error')
    useEffect(() => {
        if (!showingError) return
        const onDown = (e: PointerEvent) => {
            if (!region.current?.contains(e.target as Node)) setToasts(afterMovingOn)
        }
        document.addEventListener('pointerdown', onDown, true)
        return () => document.removeEventListener('pointerdown', onDown, true)
    }, [showingError])

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {mounted && createPortal(
                <div ref={region} style={{
                    position: 'fixed',
                    top: '20px',
                    right: '20px', // or left, or center
                    zIndex: 10001,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    // Never taller than the screen: a long stack scrolls rather than running off it.
                    maxHeight: 'calc(100vh - 40px)',
                    overflowY: 'auto',
                    pointerEvents: 'none' // Allow clicking through the container
                }}>
                    {/* Announced as they arrive (WCAG 4.1.3): the regions are always in the
                        page, so a screen reader is already listening when a toast is added.
                        Errors interrupt; the rest wait their turn. Not atomic (alert and
                        status are by default): only the toast just added is read, not every
                        one still showing (Codex review on #37). */}
                    <div role="alert" aria-atomic="false" style={{ display: 'contents' }}>
                        {toasts.filter(t => t.type === 'error').map(toast => <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />)}
                    </div>
                    <div role="status" aria-atomic="false" style={{ display: 'contents' }}>
                        {toasts.filter(t => t.type !== 'error').map(toast => <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />)}
                    </div>
                    <style jsx global>{`
                        @keyframes slideInRight {
                            from { transform: translateX(100%); opacity: 0; }
                            to { transform: translateX(0); opacity: 1; }
                        }
                    `}</style>
                </div>,
                document.body
            )}
        </ToastContext.Provider>
    )
}

export function useToast() {
    const context = useContext(ToastContext)
    if (context === undefined) {
        throw new Error('useToast must be used within a ToastProvider')
    }
    return context
}
