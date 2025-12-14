'use client'
import { useEffect, useRef } from 'react'

interface ModalProps {
    isOpen: boolean
    onClose: () => void
    title: string
    children: React.ReactNode
    hideFooter?: boolean
}

export default function Modal({ isOpen, onClose, title, children, hideFooter = false }: ModalProps) {
    const modalRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        if (isOpen) {
            document.addEventListener('keydown', handleEscape)
            document.body.style.overflow = 'hidden'
        }
        return () => {
            document.removeEventListener('keydown', handleEscape)
            document.body.style.overflow = 'unset'
        }
    }, [isOpen, onClose])

    if (!isOpen) return null

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            // No blur as requested
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            animation: 'fadeIn 0.2s ease-out'
        }} onClick={onClose}>
            <div
                ref={modalRef}
                style={{
                    backgroundColor: 'white',
                    padding: '2rem',
                    borderRadius: '1rem',
                    maxWidth: '800px', // Increased size
                    width: '90%',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    position: 'relative',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                    animation: 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                }}
                onClick={e => e.stopPropagation()}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '1rem' }}>
                    <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: '700', color: '#0f172a' }}>{title}</h2>
                    <button
                        onClick={onClose}
                        style={{
                            background: '#f1f5f9',
                            border: 'none',
                            fontSize: '1.25rem',
                            cursor: 'pointer',
                            color: '#64748b',
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#334155' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b' }}
                    >
                        &times;
                    </button>
                </div>
                <div style={{ color: '#334155', lineHeight: '1.7' }}>{children}</div>
                {!hideFooter && (
                    <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #f1f5f9', paddingTop: '1rem' }}>
                        <button
                            className="btn"
                            onClick={onClose}
                            style={{
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                color: '#475569',
                                fontWeight: '500',
                                padding: '0.6rem 1.2rem',
                                borderRadius: '0.5rem'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                            onMouseLeave={(e) => e.currentTarget.style.background = '#f8fafc'}
                        >
                            Close
                        </button>
                    </div>
                )}
            </div>
            <style jsx>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideIn {
                    from { transform: translateY(10px) scale(0.98); opacity: 0; }
                    to { transform: translateY(0) scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    )
}
