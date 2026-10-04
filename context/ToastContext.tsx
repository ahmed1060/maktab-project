'use client'

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useHydrated } from '@/lib/useHydrated'
import { useLanguage } from '@/context/LanguageContext'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
    id: string
    message: string
    type: ToastType
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

/**
 * How long a toast stays up, or null to stay until dismissed. An error stays:
 * it may say what to fix, and five seconds is not enough to read it, or to
 * find it again with a screen reader (WCAG 2.2.1; accessibility audit of
 * 4 October 2026, M1). The others go after five seconds of not being looked
 * at: the clock stops while the pointer or focus is on the toast.
 */
export function toastLifetime(type: ToastType): number | null {
    return type === 'error' ? null : 5000
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
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
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
        setToasts(prev => [...prev, { id, message, type }])
    }, [])

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id))
    }, [])

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {mounted && createPortal(
                <div style={{
                    position: 'fixed',
                    top: '20px',
                    right: '20px', // or left, or center
                    zIndex: 10001,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    pointerEvents: 'none' // Allow clicking through the container
                }}>
                    {/* Announced as they arrive (WCAG 4.1.3): the regions are always in the
                        page, so a screen reader is already listening when a toast is added.
                        Errors interrupt; the rest wait their turn. */}
                    <div role="alert" style={{ display: 'contents' }}>
                        {toasts.filter(t => t.type === 'error').map(toast => <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />)}
                    </div>
                    <div role="status" style={{ display: 'contents' }}>
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
