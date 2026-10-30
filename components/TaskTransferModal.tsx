'use client'

import AssigneeChecklist, { type Assignable } from '@/components/forms/AssigneeChecklist'
import { Button, Dialog } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'

/**
 * Moving a task to other people (DESIGN.md §5.5): the shared people
 * checklist, found by name, in a dialog. Who can be picked, and who is,
 * live with the page, which loads them and sends the transfer.
 */
export default function TaskTransferModal({ isOpen, onClose, people, onRetry, retrying, transferAssigneeIds, setTransferAssigneeIds, transferring, onTransfer }: {
    isOpen: boolean
    onClose: () => void
    /** Undefined while they load, null when they couldn't be. */
    people: Assignable[] | null | undefined
    onRetry: () => void
    retrying: boolean
    transferAssigneeIds: string[]
    setTransferAssigneeIds: (ids: string[]) => void
    transferring: boolean
    onTransfer: () => void
}) {
    const { t } = useLanguage()
    return (
        <Dialog
            open={isOpen}
            onClose={onClose}
            title={t('transfer_task_title')}
            actions={<>
                <Button onClick={onClose}>{t('cancel')}</Button>
                <Button variant="primary" onClick={onTransfer} disabled={transferAssigneeIds.length === 0} busy={transferring}>{t('confirm_transfer_button')}</Button>
            </>}
        >
            <p>{t('transfer_task_msg')}</p>
            <AssigneeChecklist
                people={people}
                value={transferAssigneeIds}
                onChange={setTransferAssigneeIds}
                onRetry={onRetry}
                retrying={retrying}
            />
        </Dialog>
    )
}
