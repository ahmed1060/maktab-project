'use client';

import React from 'react';
import { useLanguage } from '@/context/LanguageContext';

interface LanguageToggleButtonProps {
    variant?: 'fixed' | 'menu-item';
    onAction?: () => void;
}

export default function LanguageToggleButton({ variant = 'fixed', onAction }: LanguageToggleButtonProps) {
    const { locale, toggleLanguage, t } = useLanguage();

    const handleToggle = () => {
        toggleLanguage();
        if (onAction) onAction();
    };

    if (variant === 'menu-item') {
        return (
            <button
                onClick={handleToggle}
                style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.6rem 1rem',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                    borderRadius: '0.5rem',
                    transition: 'background 0.2s',
                    fontWeight: '500',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    direction: locale === 'ar' ? 'rtl' : 'ltr'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.4)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
                <span style={{ fontSize: '1.1rem' }}>🌐</span>
                {t('toggle_language')}
            </button>
        );
    }

    // Default 'fixed' variant for login page
    return (
        <button
            onClick={handleToggle}
            style={{
                position: 'fixed',
                bottom: '2rem',
                right: locale === 'en' ? '2rem' : 'auto',
                left: locale === 'ar' ? '2rem' : 'auto',
                padding: '0.75rem 1.25rem',
                background: 'rgba(255, 255, 255, 0.9)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                borderRadius: '50px',
                boxShadow: '0 4px 15px rgba(0, 0, 0, 0.1)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.9rem',
                fontWeight: '600',
                color: '#1e293b',
                transition: 'all 0.3s ease',
                zIndex: 1000,
                direction: locale === 'ar' ? 'rtl' : 'ltr'
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.15)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.1)';
            }}
        >
            <span style={{ fontSize: '1.2rem' }}>🌐</span>
            {t('toggle_language')}
        </button>
    );
}
