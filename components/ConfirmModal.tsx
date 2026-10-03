'use client'

import { createPortal } from 'react-dom'
import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useHydrated } from '@/lib/useHydrated'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'

interface ConfirmModalProps {
    isOpen: boolean
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    /** The typed reason, when `reason` is set; undefined otherwise. */
    onConfirm: (reason?: string) => void
    onCancel: () => void
    variant?: 'danger' | 'warning' | 'info'
    // When set, the confirm button stays disabled until the typed input
    // matches this exact word — for actions destructive enough that a
    // stray click on "Confirm" shouldn't be sufficient (e.g. restoring a
    // backup over current data).
    requireTypedText?: string
    // When set, the action asks for a free-text reason and hands it back on
    // confirm. Different in purpose from requireTypedText — that one proves
    // somebody meant it, this one records why — but the same widget shape, so
    // it lives here rather than in a second modal that would drift out of step
    // with this one's geometry, scrim and animation.
    reason?: {
        label: string
        placeholder?: string
        /** Confirm stays disabled below this. Default 3. */
        minLength?: number
    }
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
    requireTypedText,
    reason
}: ConfirmModalProps) {
    const { t, locale } = useLanguage()
    const mounted = useHydrated()
    const [typedValue, setTypedValue] = useState('')
    const [reasonValue, setReasonValue] = useState('')


    // Reset the typed value every time the modal opens/closes, so a
    // previous confirmation doesn't carry over to the next action.
    useAdjustOnChange([isOpen], () => {
        setTypedValue('')
        setReasonValue('')
    })

    if (!isOpen || !mounted) return null

    const reasonTooShort = !!reason && reasonValue.trim().length < (reason.minLength ?? 3)
    const confirmDisabled = (!!requireTypedText && typedValue !== requireTypedText) || reasonTooShort

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
            background: 'var(--scrim)',
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
                background: 'var(--surface)',
                padding: '2rem',
                borderRadius: '12px',
                width: 'min(calc(100vw - 3rem), 450px)',
                position: 'relative',
                zIndex: 10,
                boxShadow: '0 20px 25px -5px var(--shadow-weak), 0 10px 10px -5px var(--shadow-faint)',
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
                                    aria-label={`${t('type_to_confirm_prefix') || 'Type'} ${requireTypedText} ${t('type_to_confirm_suffix') || 'to confirm'}`}
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
                                        fontFamily: 'monospace',
                                        // Set explicitly, because an input with
                                        // neither falls back to the browser's
                                        // white ground and black text — a white
                                        // box inside a dark dialog, on the
                                        // confirmation for the most destructive
                                        // actions in the product. globals.css
                                        // records fixing exactly this for
                                        // .input across 115 elements; this one
                                        // is styled inline and was missed.
                                        background: 'var(--panel-85)',
                                        color: 'var(--text-main)',
                                    }}
                                />
                            </div>
                        )}
                        {reason && (
                            <div style={{ marginTop: '1rem' }}>
                                <label htmlFor="confirm-reason" style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                                    {reason.label}
                                </label>
                                <textarea
                                    id="confirm-reason"
                                    value={reasonValue}
                                    onChange={(e) => setReasonValue(e.target.value)}
                                    placeholder={reason.placeholder}
                                    rows={3}
                                    style={{
                                        width: '100%',
                                        padding: '0.5rem 0.75rem',
                                        border: '1px solid var(--border)',
                                        borderRadius: '0.5rem',
                                        fontSize: '0.9rem',
                                        background: 'var(--panel-85)',
                                        color: 'var(--text-main)',
                                        resize: 'vertical',
                                        fontFamily: 'inherit',
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
                            background: 'var(--surface)',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: '500',
                            color: 'var(--text-muted)',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-subtle)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'var(--surface)'}
                    >
                        {finalCancelText}
                    </button>
                    <button
                        onClick={() => onConfirm(reason ? reasonValue.trim() : undefined)}
                        disabled={confirmDisabled}
                        style={{
                            padding: '0.625rem 1.25rem',
                            border: 'none',
                            borderRadius: '0.5rem',
                            background: confirmDisabled ? 'var(--border-firm)' : styles.confirmBg,
                            cursor: confirmDisabled ? 'not-allowed' : 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: '500',
                            color: 'var(--text-on-accent)',
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
