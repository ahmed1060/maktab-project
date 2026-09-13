'use client'
import Modal from '@/components/Modal'
import { useLanguage } from '@/context/LanguageContext'

// F-23: extracted verbatim out of tasks/[id]/client.tsx. These seven are
// all short confirm/cancel dialogs, each driven entirely by state that
// still lives in the parent (populated and read by handlers there), so
// everything here is threaded through as props rather than moved in.
interface TaskConfirmModalsProps {
    // Delete task
    showDeleteConfirm: boolean
    setShowDeleteConfirm: (v: boolean) => void
    onDelete: () => void

    // Approve/Reject review
    isReviewModalOpen: boolean
    setIsReviewModalOpen: (v: boolean) => void
    reviewAction: 'APPROVED' | 'REJECTED' | null
    isTransferredTask: () => boolean
    reviewDifficulty: number
    setReviewDifficulty: (v: number) => void
    submittingReview: boolean
    onSubmitReview: () => void

    // Submit-without-attachments confirmation
    showSubmitConfirm: boolean
    setShowSubmitConfirm: (v: boolean) => void
    onConfirmSubmit: () => void

    // Delete cost/attachment/note item
    itemToDelete: { type: 'ATTACHMENT' | 'COST_ADDITION' | 'SUBMISSION_NOTE', itemId: string } | null
    setItemToDelete: (v: null) => void
    onConfirmDeleteItem: () => void

    // Delete a location-history entry
    locationToDelete: { index?: number, date?: string } | null
    setLocationToDelete: (v: null) => void
    onConfirmDeleteLocation: () => void

    // Revert to in-progress
    showRevertConfirm: boolean
    setShowRevertConfirm: (v: boolean) => void
    onRevert: () => void
    isReverting: boolean

    // Deadline-passed notice
    showDeadlineModal: boolean
    setShowDeadlineModal: (v: boolean) => void
}

export default function TaskConfirmModals({
    showDeleteConfirm, setShowDeleteConfirm, onDelete,
    isReviewModalOpen, setIsReviewModalOpen, reviewAction, isTransferredTask, reviewDifficulty, setReviewDifficulty, submittingReview, onSubmitReview,
    showSubmitConfirm, setShowSubmitConfirm, onConfirmSubmit,
    itemToDelete, setItemToDelete, onConfirmDeleteItem,
    locationToDelete, setLocationToDelete, onConfirmDeleteLocation,
    showRevertConfirm, setShowRevertConfirm, onRevert, isReverting,
    showDeadlineModal, setShowDeadlineModal
}: TaskConfirmModalsProps) {
    const { t, locale } = useLanguage()

    return (
        <>
            {/* Delete Modal */}
            <Modal isOpen={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title={t('delete_task_title')} hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p>{t('delete_task_warning')}</p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setShowDeleteConfirm(false)} className="btn" style={{ background: 'var(--border)' }}>{t('cancel')}</button>
                        <button onClick={() => {
                            setShowDeleteConfirm(false)
                            onDelete()
                        }} className="btn" style={{ background: 'var(--danger-solid)', color: 'var(--text-on-accent)' }}>{t('delete')}</button>
                    </div>
                </div>
            </Modal>

            {/* Review Modal (Approve/Reject) */}
            <Modal isOpen={isReviewModalOpen} onClose={() => setIsReviewModalOpen(false)} title={reviewAction === 'APPROVED' ? t('confirm_approval_title') : t('confirm_rejection_title')} hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p style={{ marginBottom: '1.25rem' }}>
                        {t('confirm_task_action_msg').replace('{action}', reviewAction === 'APPROVED' ? (locale === 'ar' ? 'الموافقة على' : 'approve') : (locale === 'ar' ? 'رفض' : 'reject'))}
                        {isTransferredTask() ? t('is_transferred_difficulty_hint') : t('are_you_sure_msg')}
                    </p>
                    {isTransferredTask() && (
                        <div style={{ marginBottom: '1.5rem' }}>
                            <label className="label">{t('points_label')}</label>
                            <input type="number" className="input" value={reviewDifficulty} onChange={e => setReviewDifficulty(parseInt(e.target.value) || 0)} min={0} max={100} style={{ width: '100%' }} />
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setIsReviewModalOpen(false)} className="btn" style={{ background: 'var(--border)' }}>{t('cancel')}</button>
                        <button onClick={onSubmitReview} disabled={submittingReview} className="btn" style={{ background: reviewAction === 'APPROVED' ? 'var(--ok-solid-hover)' : 'var(--danger-solid-hover)', color: 'var(--text-on-accent)', minWidth: '100px' }}>
                            {submittingReview ? '...' : t('confirm_action_button')}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Submit Confirmation Modal */}
            <Modal isOpen={showSubmitConfirm} onClose={() => setShowSubmitConfirm(false)} title={t('confirm_submission_title')} hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p>{t('confirm_submission_msg')}</p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setShowSubmitConfirm(false)} className="btn" style={{ background: 'var(--border)' }}>{t('cancel')}</button>
                        <button onClick={() => { setShowSubmitConfirm(false); onConfirmSubmit(); }} className="btn btn-primary">{t('confirm_submit_button')}</button>
                    </div>
                </div>
            </Modal>

            {/* Delete Item Modal */}
            <Modal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} title={
                itemToDelete?.type === 'COST_ADDITION' ? t('delete_cost_title') :
                    itemToDelete?.type === 'ATTACHMENT' ? t('delete_attachment_title') :
                        t('delete_note_title')
            } hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p>{t('confirm_item_delete')}</p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setItemToDelete(null)} className="btn" style={{ background: 'var(--border)' }}>{t('cancel')}</button>
                        <button onClick={onConfirmDeleteItem} className="btn" style={{ background: 'var(--danger-solid-hover)', color: 'var(--text-on-accent)' }}>{t('delete')}</button>
                    </div>
                </div>
            </Modal>

            {/* Delete Location Modal */}
            <Modal isOpen={!!locationToDelete} onClose={() => setLocationToDelete(null)} title={t('delete_location_title')} hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p>{t('delete_location_warning')}</p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setLocationToDelete(null)} className="btn" style={{ background: 'var(--border)' }}>{t('cancel')}</button>
                        <button onClick={onConfirmDeleteLocation} className="btn" style={{ background: 'var(--danger-solid-hover)', color: 'var(--text-on-accent)' }}>{t('delete')}</button>
                    </div>
                </div>
            </Modal>

            {/* Revert Confirmation Modal */}
            <Modal isOpen={showRevertConfirm} onClose={() => setShowRevertConfirm(false)} title={t('return_to_in_progress')} hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p>{t('confirm_action_button') + '?'}</p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setShowRevertConfirm(false)} className="btn" style={{ background: 'var(--border)' }}>{t('cancel')}</button>
                        <button onClick={onRevert} className="btn" style={{ background: 'var(--info-solid-hover)', color: 'var(--text-on-accent)' }}>
                            {isReverting ? '...' : t('confirm_action_button')}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Deadline Passed Modal */}
            <Modal isOpen={showDeadlineModal} onClose={() => setShowDeadlineModal(false)} title={t('deadline_passed_title' as any) || (locale === 'ar' ? 'انتهى الموعد النهائي' : 'Deadline Passed')} hideFooter hideCloseButton={true}>
                <div id="deadline-modal-content" style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p style={{ fontSize: '1.1rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>
                        {t('overdue_task_alert_msg' as any)}
                    </p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setShowDeadlineModal(false)} className="btn btn-primary" style={{ minWidth: '100px' }}>
                            {t('confirm_action_button')}
                        </button>
                    </div>
                </div>
            </Modal>
        </>
    )
}
