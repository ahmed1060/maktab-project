'use client'
import { useState } from 'react'
import Modal from '@/components/Modal'
import { useLanguage } from '@/context/LanguageContext'

interface CreateRequestModalProps {
    isOpen: boolean
    onClose: () => void
    onSubmit: (title: string, details: string) => Promise<void>
}

export default function CreateRequestModal({ isOpen, onClose, onSubmit }: CreateRequestModalProps) {
    const { t, locale } = useLanguage()
    const [title, setTitle] = useState('')
    const [details, setDetails] = useState('')
    const [submitting, setSubmitting] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!title.trim() || !details.trim() || submitting) return

        setSubmitting(true)
        try {
            await onSubmit(title, details)
            setTitle('')
            setDetails('')
            onClose()
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t('make_a_request')}
            hideFooter
        >
            <form onSubmit={handleSubmit} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                <div style={{ marginBottom: '1.5rem' }}>
                    <label className="label" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                        {t('title')}
                    </label>
                    <input
                        type="text"
                        className="input"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t('request_title')}
                        required
                        disabled={submitting}
                        style={{ width: '100%' }}
                    />
                </div>
                <div style={{ marginBottom: '1.5rem' }}>
                    <label className="label" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                        {t('details')}
                    </label>
                    <textarea
                        className="input"
                        rows={5}
                        value={details}
                        onChange={(e) => setDetails(e.target.value)}
                        placeholder={t('request_details_placeholder')}
                        required
                        disabled={submitting}
                        style={{ width: '100%', resize: 'none' }}
                    />
                </div>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '2rem' }}>
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn"
                        style={{
                            background: 'var(--surface-sunk)',
                            color: 'var(--text-soft)',
                            minWidth: '100px'
                        }}
                        disabled={submitting}
                    >
                        {t('close')}
                    </button>
                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{
                            minWidth: '100px'
                        }}
                        disabled={submitting}
                    >
                        {submitting ? t('submitting') : t('apply')}
                    </button>
                </div>
            </form>
        </Modal>
    )
}
