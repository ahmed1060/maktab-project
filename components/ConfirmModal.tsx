'use client'

import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'
import { useLanguage } from '@/context/LanguageContext'

interface ConfirmModalProps {
    isOpen: boolean
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    onConfirm: () => void
    onCancel: () => void
    variant?: 'danger' | 'warning' | 'info'
    // When set, the confirm button stays disabled until the typed input
    // matches this exact word — for actions destructive enough that a
    // stray click on "Confirm" shouldn't be sufficient (e.g. restoring a
    // backup over current data).
    requireTypedText?: string
}

export default function ConfirmModal({
    isOpen,
    title,
    message,
    confirmText,
    cancelText,
    onConfirm,
    onCancel,
    variant = 'danger',
    requireTypedText
}: ConfirmModalProps) {
    const { t, locale } = useLanguage()
    const [mounted, setMounted] = useState(false)
    const [typedValue, setTypedValue] = useState('')

    useEffect(() => {
        setMounted(true)
    }, [])

    // Reset the typed value every time the modal opens/closes, so a
    // previous confirmation doesn't carry over to the next action.
    useEffect(() => {
        setTypedValue('')
    }, [isOpen])

    if (!isOpen || !mounted) return null

    const confirmDisabled = !!requireTypedText && typedValue !== requireTypedText

    const finalConfirmText = confirmText || t('confirm') || 'Confirm'
    const finalCancelText = cancelText || t('cancel') || 'Cancel'

    const variantStyles = {
        danger: {
            confirmBg: 'var(--danger-solid-hover)',
            confirmHover: 'var(--danger-fg-strong)',
            iconBg: 'var(--danger-bg)',
            iconColor: 'var(--danger-solid-hover)'
        },
        warning: {
            confirmBg: 'var(--warn-solid)',
            confirmHover: 'var(--warn-solid-hover)',
            iconBg: 'var(--warn-bg)',
            iconColor: 'var(--warn-solid)'
        },
        info: {
            confirmBg: 'var(--info-solid)',
            confirmHover: 'var(--info-solid-hover)',
            iconBg: 'var(--info-bg-indigo)',
            iconColor: 'var(--info-solid)'
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
                width: 'min(calc(100vw - 3rem), 450px)',
                position: 'relative',
                zIndex: 10,
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                animation: 'slideUp 0.3s ease-out',
                direction: locale === 'ar' ? 'rtl' : 'ltr',
                textAlign: locale === 'ar' ? 'right' : 'left'
            }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.5rem', flexDirection: 'row' }}>
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
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--text-main)', margin: '0 0 0.5rem 0' }}>
                            {title}
                        </h2>
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-soft)', margin: 0, lineHeight: '1.5' }}>
                            {message}
                        </p>
                        {requireTypedText && (
                            <div style={{ marginTop: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                                    {t('type_to_confirm_prefix') || 'Type'} <code style={{ background: 'var(--surface-sunk)', padding: '0.1rem 0.4rem', borderRadius: '0.25rem', fontWeight: 700 }}>{requireTypedText}</code> {t('type_to_confirm_suffix') || 'to confirm'}
                                </label>
                                <input
                                    type="text"
                                    value={typedValue}
                                    onChange={(e) => setTypedValue(e.target.value)}
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    style={{
                                        width: '100%',
                                        padding: '0.5rem 0.75rem',
                                        border: '1px solid var(--border)',
                                        borderRadius: '0.5rem',
                                        fontSize: '0.9rem',
                                        fontFamily: 'monospace'
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                    <button
                        onClick={onCancel}
                        style={{
                            padding: '0.625rem 1.25rem',
                            border: '1px solid var(--border)',
                            borderRadius: '0.5rem',
                            background: 'white',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: '500',
                            color: 'var(--text-muted)',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-subtle)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                    >
                        {finalCancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={confirmDisabled}
                        style={{
                            padding: '0.625rem 1.25rem',
                            border: 'none',
                            borderRadius: '0.5rem',
                            background: confirmDisabled ? 'var(--border-firm)' : styles.confirmBg,
                            cursor: confirmDisabled ? 'not-allowed' : 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: '500',
                            color: 'white',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => { if (!confirmDisabled) e.currentTarget.style.background = styles.confirmHover }}
                        onMouseLeave={(e) => { if (!confirmDisabled) e.currentTarget.style.background = styles.confirmBg }}
                    >
                        {finalConfirmText}
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
