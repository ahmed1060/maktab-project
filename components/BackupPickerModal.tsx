'use client'

import { createPortal } from 'react-dom'

import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useHydrated } from '@/lib/useHydrated'

export type BackupEntry = {
    folder: 'daily' | 'weekly' | 'monthly'
    baseName: string
    sizeBytes: number
    modifiedTime: string
}

interface BackupPickerModalProps {
    isOpen: boolean
    backups: BackupEntry[]
    loading: boolean
    error: string | null
    onSelect: (backup: BackupEntry) => void
    onClose: () => void
}

function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${bytes} B`
}

export default function BackupPickerModal({ isOpen, backups, loading, error, onSelect, onClose }: BackupPickerModalProps) {
    const { t, locale } = useLanguage()
    const mounted = useHydrated()

    if (!isOpen || !mounted) return null

    return createPortal(
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'var(--scrim)', display: 'flex', justifyContent: 'center',
            alignItems: 'center', zIndex: 10000
        }}>
            <div className="modal-backdrop" onClick={onClose} />
            <div style={{
                background: 'var(--surface)', padding: '1.5rem', borderRadius: '12px',
                width: 'min(calc(100vw - 3rem), 560px)', maxHeight: '80vh',
                display: 'flex', flexDirection: 'column',
                position: 'relative', zIndex: 10,
                boxShadow: '0 20px 25px -5px var(--shadow-weak), 0 10px 10px -5px var(--shadow-faint)',
                direction: locale === 'ar' ? 'rtl' : 'ltr',
                textAlign: locale === 'ar' ? 'right' : 'left'
            }}>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 1rem' }}>
                    {t('backup_picker_title' as any)}
                </h2>

                <div style={{ overflowY: 'auto', flex: 1, minHeight: '120px' }}>
                    {loading && (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
                            <LoadingSpinner message={t('backup_picker_loading' as any)} />
                        </div>
                    )}
                    {!loading && error && (
                        <p style={{ color: 'var(--danger-solid-hover)', fontSize: '0.9rem', padding: '1rem 0' }}>{error}</p>
                    )}
                    {!loading && !error && backups.length === 0 && (
                        <p style={{ color: 'var(--text-soft)', fontSize: '0.9rem', padding: '1rem 0' }}>{t('backup_picker_empty' as any)}</p>
                    )}
                    {!loading && !error && backups.map((b) => (
                        <div key={`${b.folder}/${b.baseName}`} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid var(--border)',
                            marginBottom: '0.5rem'
                        }}>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', overflowWrap: 'anywhere' }}>
                                    {b.baseName}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-soft)', marginTop: '0.15rem' }}>
                                    {t(`backup_folder_${b.folder}` as any)} · {b.modifiedTime ? new Date(b.modifiedTime).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US') : '—'} · {formatSize(b.sizeBytes)}
                                </div>
                            </div>
                            <button
                                onClick={() => onSelect(b)}
                                className="btn"
                                style={{ flexShrink: 0, whiteSpace: 'nowrap', fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
                            >
                                {t('backup_picker_select' as any)}
                            </button>
                        </div>
                    ))}
                </div>

                <button
                    onClick={onClose}
                    style={{
                        marginTop: '1rem', padding: '0.6rem', border: '1px solid var(--border)',
                        borderRadius: '0.5rem', background: 'var(--surface)', cursor: 'pointer',
                        fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-muted)'
                    }}
                >
                    {t('cancel') || 'Cancel'}
                </button>
            </div>
        </div>,
        document.body
    )
}
