'use client'
import { useState } from 'react'
import Modal from '@/components/Modal'
import { useLanguage } from '@/context/LanguageContext'

// F-23: extracted verbatim out of tasks/[id]/client.tsx. searchTermTransfer
// was only ever read inside this modal's own filter, so it moved in as
// local state; transferAssigneeIds/allUsers/userFetchError/transferring
// stay with the parent (populated by a useEffect and read by
// handleTransfer there), so they're threaded through as props.
interface TaskTransferModalProps {
    isOpen: boolean
    onClose: () => void
    allUsers: any[]
    userFetchError: boolean
    transferAssigneeIds: string[]
    setTransferAssigneeIds: (ids: string[]) => void
    transferring: boolean
    onTransfer: () => void
}

export default function TaskTransferModal({
    isOpen, onClose, allUsers, userFetchError, transferAssigneeIds, setTransferAssigneeIds, transferring, onTransfer
}: TaskTransferModalProps) {
    const { t, locale } = useLanguage()
    const [searchTermTransfer, setSearchTermTransfer] = useState('')

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('transfer_task_title')} hideFooter>
            <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                <p style={{ marginBottom: '1.25rem', lineHeight: '1.5' }}>{t('transfer_task_msg')}</p>

                <input
                    type="text"
                    className="input"
                    placeholder={t('search_placeholder')}
                    value={searchTermTransfer}
                    onChange={e => setSearchTermTransfer(e.target.value)}
                    style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}
                />

                <div style={{
                    maxHeight: '200px',
                    overflowY: 'auto',
                    border: '1px solid var(--border)',
                    borderRadius: '0.5rem',
                    padding: '0.75rem',
                    background: 'var(--surface-subtle)',
                    marginBottom: '1.5rem'
                }}>
                    {allUsers.length > 0 ? (
                        allUsers.filter(u => `${u.firstName} ${u.lastName}`.toLowerCase().includes(searchTermTransfer.toLowerCase())).length > 0 ? (
                            allUsers.filter(u => `${u.firstName} ${u.lastName}`.toLowerCase().includes(searchTermTransfer.toLowerCase())).map(u => (
                                <label key={u.id} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    marginBottom: '0.5rem',
                                    cursor: 'pointer',
                                    padding: '0.25rem'
                                }}>
                                    <input
                                        type="checkbox"
                                        checked={transferAssigneeIds.includes(u.id)}
                                        onChange={e => {
                                            if (e.target.checked) {
                                                setTransferAssigneeIds([...transferAssigneeIds, u.id])
                                            } else {
                                                setTransferAssigneeIds(transferAssigneeIds.filter(id => id !== u.id))
                                            }
                                        }}
                                    />
                                    <span style={{ fontSize: '0.9rem' }}>
                                        {u.firstName} {u.lastName} <small style={{ color: 'var(--text-soft)' }}>({t(`role_${u.role?.toLowerCase()}` as any)})</small>
                                    </span>
                                </label>
                            ))
                        ) : (
                            <div style={{ fontSize: '0.9rem', color: 'var(--text-soft)', textAlign: 'center' }}>{t('no_data_available')}</div>
                        )
                    ) : userFetchError ? (
                        <div style={{ fontSize: '0.9rem', color: 'var(--danger-solid)' }}>{t('failed_fetch_data')}</div>
                    ) : (
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-soft)' }}>{locale === 'ar' ? 'جاري التحميل...' : 'Loading...'}</div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                    <button onClick={onClose} className="btn" style={{ background: 'var(--border)' }}>{t('cancel')}</button>
                    <button onClick={onTransfer} disabled={transferAssigneeIds.length === 0 || transferring} className="btn btn-primary">{transferring ? '...' : t('confirm_transfer_button')}</button>
                </div>
            </div>
        </Modal>
    )
}
