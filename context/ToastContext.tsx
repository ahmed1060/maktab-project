'use client'

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'

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

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    const showToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = Math.random().toString(36).substring(2, 9)
        setToasts(prev => [...prev, { id, message, type }])

        // Auto remove after 5 seconds
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id))
        }, 5000)
    }, [])

    const removeToast = (id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id))
    }

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
                    {toasts.map(toast => (
                        <div
                            key={toast.id}
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
                                onClick={() => removeToast(toast.id)}
                                style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: '#94a3b8',
                                    cursor: 'pointer',
                                    fontSize: '1.2rem',
                                    lineHeight: '1',
                                    padding: '0'
                                }}
                            >
                                &times;
                            </button>
                        </div>
                    ))}
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
