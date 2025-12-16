'use client'

import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'

interface ConfirmModalProps {
    isOpen: boolean
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    onConfirm: () => void
    onCancel: () => void
    variant?: 'danger' | 'warning' | 'info'
}

export default function ConfirmModal({
    isOpen,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    onConfirm,
    onCancel,
    variant = 'danger'
}: ConfirmModalProps) {
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    if (!isOpen || !mounted) return null

    const variantStyles = {
        danger: {
            confirmBg: '#dc2626',
            confirmHover: '#b91c1c',
            iconBg: '#fee2e2',
            iconColor: '#dc2626'
        },
        warning: {
            confirmBg: '#f59e0b',
            confirmHover: '#d97706',
            iconBg: '#fef3c7',
            iconColor: '#f59e0b'
        },
        info: {
            confirmBg: '#3b82f6',
            confirmHover: '#2563eb',
            iconBg: '#dbeafe',
            iconColor: '#3b82f6'
        }
    }

    const styles = variantStyles[variant]

    return createPortal(
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 10000,
            animation: 'fadeIn 0.2s ease-out'
        }}>
            <div
                className="absolute inset-0"
                onClick={onCancel}
            />
            <div style={{
                background: 'white',
                padding: '2rem',
                borderRadius: '12px',
                width: '100%',
                maxWidth: '450px',
                position: 'relative',
                zIndex: 10,
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                animation: 'slideUp 0.3s ease-out'
            }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        background: styles.iconBg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                    }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={styles.iconColor} strokeWidth="2">
                            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                            <line x1="12" y1="9" x2="12" y2="13" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                    </div>
                    <div style={{ flex: 1 }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#1e293b', margin: '0 0 0.5rem 0' }}>
                            {title}
                        </h2>
                        <p style={{ fontSize: '0.875rem', color: '#64748b', margin: 0, lineHeight: '1.5' }}>
                            {message}
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                    <button
                        onClick={onCancel}
                        style={{
                            padding: '0.625rem 1.25rem',
                            border: '1px solid #e2e8f0',
                            borderRadius: '0.5rem',
                            background: 'white',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: '500',
                            color: '#475569',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        style={{
                            padding: '0.625rem 1.25rem',
                            border: 'none',
                            borderRadius: '0.5rem',
                            background: styles.confirmBg,
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: '500',
                            color: 'white',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = styles.confirmHover}
                        onMouseLeave={(e) => e.currentTarget.style.background = styles.confirmBg}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>

            <style jsx global>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from {
                        opacity: 0;
                        transform: translateY(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
            `}</style>
        </div>,
        document.body
    )
}
