'use client'

import { useLanguage } from '@/context/LanguageContext'

interface LoadingSpinnerProps {
    message?: string
    fullPage?: boolean
}

export default function LoadingSpinner({ message, fullPage = false }: LoadingSpinnerProps) {
    const { t, locale } = useLanguage()

    const spinnerContent = (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: fullPage ? '100vh' : '400px',
            gap: '1.25rem',
            padding: '2rem'
        }}>
            <div className="animate-spin" style={{
                width: '40px',
                height: '40px',
                border: '4px solid rgba(59, 130, 246, 0.1)',
                borderTopColor: '#3b82f6',
                borderRadius: '50%'
            }}></div>
            <p style={{
                color: '#64748b',
                fontSize: '0.95rem',
                fontWeight: '500',
                textAlign: locale === 'ar' ? 'right' : 'left'
            }}>
                {message || t('loading_data')}
            </p>
            <style>{`
                @keyframes spin-loading {
                    to { transform: rotate(360deg); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .animate-spin {
                    animation: spin-loading 1s linear infinite;
                }
            `}</style>
        </div >
    )

    if (fullPage) {
        return (
            <div style={{
                position: 'fixed',
                inset: 0,
                zIndex: 99999,
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                backdropFilter: 'blur(16px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                animation: 'fadeIn 0.2s ease-out'
            }}>
                {spinnerContent}
            </div>
        )
    }

    return spinnerContent
}
