'use client'

import { Button, Dialog, Field, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useBusyAction } from '@/lib/useBusyAction'

// A task page's short confirmations (DESIGN.md §5.5), each driven by state
// that lives in the page (set and read by its handlers there), so it's all
// passed in rather than moved in.

interface TaskConfirmModalsProps {
    // Delete task
    showDeleteConfirm: boolean
    setShowDeleteConfirm: (v: boolean) => void
    onDelete: () => Promise<void>

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
    itemToDelete: { type: 'ATTACHMENT' | 'COST' | 'COST_ADDITION' | 'SUBMISSION_NOTE', itemId: string } | null
    setItemToDelete: (v: null) => void
    onConfirmDeleteItem: () => Promise<void>

    // Delete a location-history entry
    locationToDelete: { index?: number, date?: string } | null
    setLocationToDelete: (v: null) => void
    onConfirmDeleteLocation: () => Promise<void>

    // Revert to in-progress
    showRevertConfirm: boolean
    setShowRevertConfirm: (v: boolean) => void
    onRevert: () => void
    isReverting: boolean
}

export default function TaskConfirmModals({
    showDeleteConfirm, setShowDeleteConfirm, onDelete,
    isReviewModalOpen, setIsReviewModalOpen, reviewAction, isTransferredTask, reviewDifficulty, setReviewDifficulty, submittingReview, onSubmitReview,
    showSubmitConfirm, setShowSubmitConfirm, onConfirmSubmit,
    itemToDelete, setItemToDelete, onConfirmDeleteItem,
    locationToDelete, setLocationToDelete, onConfirmDeleteLocation,
    showRevertConfirm, setShowRevertConfirm, onRevert, isReverting,
}: TaskConfirmModalsProps) {
    const { t } = useLanguage()
    const action = useBusyAction()
    const approving = reviewAction === 'APPROVED'
    const transferred = isReviewModalOpen && isTransferredTask()

    return (
        <>
            <Dialog
                open={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                title={t('delete_task_title')}
                actions={<>
                    <Button onClick={() => setShowDeleteConfirm(false)}>{t('cancel')}</Button>
                    <Button variant="danger" onClick={() => action.run('task', onDelete)} disabled={action.running} busy={action.is('task')}>{t('delete')}</Button>
                </>}
            >
                <p>{t('delete_task_warning')}</p>
            </Dialog>

            {/* Approving gives it its points; one transferred has them checked first. */}
            <Dialog
                open={isReviewModalOpen}
                onClose={() => setIsReviewModalOpen(false)}
                title={approving ? t('task_approve_title') : t('task_reject_title')}
                actions={<>
                    <Button onClick={() => setIsReviewModalOpen(false)}>{t('cancel')}</Button>
                    <Button variant={approving ? 'primary' : 'danger'} onClick={onSubmitReview} busy={submittingReview}>
                        {approving ? t('approve_button') : t('reject_button')}
                    </Button>
                </>}
            >
                <p>{approving ? t('task_approve_body') : t('task_reject_body')}</p>
                {transferred && (
                    <Field label={t('points_label')} hint={t('task_transferred_points_hint')}>{p => (
                        <TextInput {...p} type="number" inputMode="numeric" name="points" autoComplete="off" min={0} max={100} value={reviewDifficulty} onChange={e => setReviewDifficulty(parseInt(e.target.value) || 0)} />
                    )}</Field>
                )}
            </Dialog>

            <Dialog
                open={showSubmitConfirm}
                onClose={() => setShowSubmitConfirm(false)}
                title={t('confirm_submission_title')}
                actions={<>
                    <Button onClick={() => setShowSubmitConfirm(false)}>{t('cancel')}</Button>
                    <Button variant="primary" onClick={() => { setShowSubmitConfirm(false); onConfirmSubmit() }}>{t('confirm_submit_button')}</Button>
                </>}
            >
                <p>{t('confirm_submission_msg')}</p>
            </Dialog>

            <Dialog
                open={!!itemToDelete}
                onClose={() => setItemToDelete(null)}
                title={
                    itemToDelete?.type === 'COST' || itemToDelete?.type === 'COST_ADDITION' ? t('delete_cost_title') :
                        itemToDelete?.type === 'ATTACHMENT' ? t('delete_attachment_title') :
                            t('delete_note_title')
                }
                actions={<>
                    <Button onClick={() => setItemToDelete(null)}>{t('cancel')}</Button>
                    <Button variant="danger" onClick={() => action.run('item', onConfirmDeleteItem)} disabled={action.running} busy={action.is('item')}>{t('delete')}</Button>
                </>}
            >
                <p>{t('confirm_item_delete')}</p>
            </Dialog>

            <Dialog
                open={!!locationToDelete}
                onClose={() => setLocationToDelete(null)}
                title={t('delete_location_title')}
                actions={<>
                    <Button onClick={() => setLocationToDelete(null)}>{t('cancel')}</Button>
                    <Button variant="danger" onClick={() => action.run('location', onConfirmDeleteLocation)} disabled={action.running} busy={action.is('location')}>{t('delete')}</Button>
                </>}
            >
                <p>{t('delete_location_warning')}</p>
            </Dialog>

            <Dialog
                open={showRevertConfirm}
                onClose={() => setShowRevertConfirm(false)}
                title={t('return_to_in_progress')}
                actions={<>
                    <Button onClick={() => setShowRevertConfirm(false)}>{t('cancel')}</Button>
                    <Button variant="primary" onClick={onRevert} busy={isReverting}>{t('return_to_in_progress')}</Button>
                </>}
            >
                <p>{t('task_revert_body')}</p>
            </Dialog>
        </>
    )
}
