'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowCounterClockwiseIcon, CheckIcon, PushPinIcon, TrashIcon, UserSwitchIcon, XIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import SafeDate from '@/components/SafeDate'
import AssigneeChecklist, { type Assignable } from '@/components/forms/AssigneeChecklist'
import { Button, Card, Details, Dialog, DueDate, EmptyState, FileChip, FileChips, FilePicker, Page, PageHeader, RowMenu, StatusBadge, taskStatusTone, type MenuItem } from '@/components/ui'
import { SESSION_EXPIRED_MESSAGE, redirectAfterSessionExpiry } from '@/lib/session-expired'
import { RECURRENCE_STYLE } from '@/lib/recurrence'
import { countOf } from '@/lib/plural'
import { useCan } from '@/lib/useCan'
import { useModules } from '@/lib/useModules'
import { useBusyAction } from '@/lib/useBusyAction'
import { fetchRetrying } from '@/lib/swr-fetcher'
import type { TranslationKey } from '@/lib/translations'
import { decidedByName } from '@/lib/decided-by'

const FILE_TYPES = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']
const FILE_MAX_BYTES = 4 * 1024 * 1024
/** Done with: nothing more is handed in, and an assignee who was deleted no longer matters. */
const DECIDED = ['APPROVED', 'COMPLETED', 'REJECTED']

type Attachment = { name?: string; url: string; uploadedById?: string }

/** Its files, from however they were saved: a list, one object, or a bare address from before. */
function attachmentsOf(saved: string | null | undefined): Attachment[] {
    if (!saved) return []
    try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) return parsed.map(a => typeof a === 'string' ? { url: a } : a)
        if (parsed?.url) return [parsed]
        return []
    } catch {
        return saved.startsWith('http') ? [{ url: saved }] : []
    }
}

const fileName = (a: Attachment) => a.name || a.url.split('/').pop() || a.url

/** An address that isn't an obligation, or no longer is: said on a page with the way back. */
export function ObligationNotFound() {
    const { t } = useLanguage()
    const modules = useModules()
    return (
        <Page>
            <PageHeader title={modules.label('obligations')} back={{ href: '/dashboard/obligations', label: modules.label('obligations') }} />
            <div className="ui-panel">
                <EmptyState icon={PushPinIcon} title={t('obligation_not_found')} />
            </div>
        </Page>
    )
}

/**
 * An obligation's page (DESIGN.md §5.5): its header, with its status and a
 * manager's decision; its details; its files; and what its assignee hands in.
 */
export default function ObligationDetailClient({ obligation, now, userRole, userId, userName, creatorName, creatorUnknown }: {
    obligation: any
    /** When the server drew it, so its deadline reads the same on the server and here. */
    now: number
    userRole: string
    userId: string
    userName: string
    creatorName: string | null
    creatorUnknown: boolean
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const modules = useModules()
    const router = useRouter()
    const action = useBusyAction()
    // From the role the page passed down, so the first paint is complete.
    // Someone without obligations.view acts on an obligation only as its
    // assignee. Deciding or deleting one you are assigned to is refused to a
    // company-wide manager (the self-approval rules in ObligationService); a
    // Team Leader manages their team's, their own among them.
    const { can, companyWide, scope } = useCan()
    const seesOthers = can('obligations.view')
    const canManage = can('obligations.manage')
    const teamReach = scope('obligations.view') === 'TEAM'
    const mayManageThis = canManage && (scope('obligations.manage') === 'TEAM' || !obligation.assignees?.some((a: any) => a.id === userId))

    const isOverdue = new Date(obligation.deadline).getTime() < now && ['PENDING', 'IN_PROGRESS'].includes(obligation.status)
    // Past its deadline, whoever does it can't add to it any more, nor take
    // files off it, and is told to see whoever assigned it.
    const isUserAssignee = obligation.assignees?.some((a: any) => a.id === userId)
    const isRestrictedRole = !seesOthers || (teamReach && isUserAssignee)
    const locked = isRestrictedRole && isOverdue

    const [pendingFiles, setPendingFiles] = useState<File[]>([])
    const [sending, setSending] = useState<'DRAFT' | 'SUBMIT' | null>(null)
    const [deleting, setDeleting] = useState(false)
    const [reverting, setReverting] = useState(false)
    const [removing, setRemoving] = useState<Attachment | null>(null)
    const [reassigning, setReassigning] = useState(false)

    const fail = useCallback(async (res: Response, fallback: string) => {
        if (res.status === 401) {
            showToast(SESSION_EXPIRED_MESSAGE, 'error')
            redirectAfterSessionExpiry(router)
            return
        }
        const data = await res.json().catch(() => ({}))
        showToast(data.error || fallback, 'error')
    }, [router, showToast])

    const handleUpload = useCallback(async (isDraft: boolean, isEmergency?: boolean) => {
        setSending(isDraft ? 'DRAFT' : 'SUBMIT')
        const uploadedAttachments: any[] = []
        const notSent: File[] = []
        try {
            for (const file of pendingFiles) {
                const formData = new FormData()
                formData.append('file', file)
                try {
                    // Emergency saves need this on the upload step too, not
                    // just the final PUT below: the server exempts POST
                    // /api/upload the same way when this header is present
                    // (see lib/api-utils.ts), or a suspended or banned user's
                    // attachment never makes it in though their status does.
                    const res = await fetch('/api/upload', {
                        method: 'POST',
                        headers: isEmergency ? { 'X-Emergency-Save': 'true' } : undefined,
                        body: formData
                    })
                    const result = await res.json()
                    if (result.success && result.data?.url) {
                        uploadedAttachments.push({
                            name: file.name,
                            url: result.data.url,
                            type: file.type,
                            uploadedBy: userName,
                            uploadedById: userId,
                            uploadedAt: new Date().toISOString()
                        })
                    } else {
                        notSent.push(file)
                    }
                } catch (err) {
                    console.error('Upload error', err)
                    notSent.push(file)
                }
            }

            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            if (isEmergency) headers['X-Emergency-Save'] = 'true'
            const res = await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                    status: isDraft ? 'IN_PROGRESS' : 'PENDING_CONFIRMATION',
                    newAttachments: uploadedAttachments
                })
            })
            if (!res.ok) {
                await fail(res, t('failed_save_generic'))
                return
            }
            // A file that didn't go up stays, to be sent again.
            setPendingFiles(notSent)
            router.refresh()
            if (notSent.length) showToast(t('failed_upload_files'), 'error')
            else showToast(isDraft ? t('draft_saved_success') : t('obligation_submitted_success'), 'success')
        } catch (error: any) {
            console.error('Update failed', error)
            showToast(error.message || t('failed_save_generic'), 'error')
        } finally {
            setSending(null)
        }
    }, [pendingFiles, obligation.id, router, t, userId, userName, fail, showToast, setPendingFiles])

    // Listen for suspension auto-save event
    useEffect(() => {
        const handleSuspendSave = async () => {
            try {
                // Only auto-save while its assignee is working on it.
                if (!seesOthers && !['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(obligation.status)) {
                    await handleUpload(true, true)
                }
            } finally {
                // Tells UserHeartbeat it can stop waiting and sign out/redirect
                // now — whether or not there was anything to save. Without
                // this it has no way to know a save on this page even
                // happened, so it just waits out its own flat timeout.
                window.dispatchEvent(new CustomEvent('app:emergency-save-complete'))
            }
        }
        window.addEventListener('app:suspend-detected', handleSuspendSave)
        return () => window.removeEventListener('app:suspend-detected', handleSuspendSave)
    }, [obligation.status, handleUpload, seesOthers])

    const attachments = attachmentsOf(obligation.attachments)
    // Taking a file off is for whoever manages it: their own files, or
    // anyone's for those who manage company-wide.
    const mayRemove = (att: Attachment) => !locked && canManage && (att.uploadedById === userId || companyWide('obligations.manage'))

    const handleRemoveAttachment = async (gone: Attachment) => {
        try {
            const res = await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ attachments: attachmentsOf(obligation.attachments).filter(a => a.url !== gone.url) })
            })
            if (!res.ok) return fail(res, t('failed_save_generic'))
            setRemoving(null)
            router.refresh()
            showToast(t('obligation_file_removed'), 'success')
        } catch (error) {
            console.error('Failed to remove attachment', error)
            showToast(t('failed_save_generic'), 'error')
        }
    }

    const handleFiles = (files: File[]) => {
        const fits: File[] = []
        for (const file of files) {
            const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
            if (file.size > FILE_MAX_BYTES) showToast(t('obligation_file_too_large').replace('{name}', file.name), 'error')
            else if (!FILE_TYPES.includes(ext)) showToast(t('obligation_file_wrong_type').replace('{name}', file.name), 'error')
            else fits.push(file)
        }
        setPendingFiles(prev => [...prev, ...fits])
    }

    const decide = async (status: 'APPROVED' | 'REJECTED') => {
        try {
            const res = await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            })
            if (!res.ok) return fail(res, t('failed_save_generic'))
            router.refresh()
            showToast(t(status === 'APPROVED' ? 'obligation_approved_success' : 'obligation_rejected_success'), 'success')
        } catch (error) {
            console.error(error)
            showToast(t('failed_save_generic'), 'error')
        }
    }
    const handleApprove = () => decide('APPROVED')
    const handleReject = () => decide('REJECTED')

    const handleDelete = async () => {
        try {
            const res = await fetch(`/api/obligations/${obligation.id}`, { method: 'DELETE' })
            if (!res.ok) return fail(res, t('failed_save_generic'))
            router.push('/dashboard/obligations')
            router.refresh()
        } catch (error: any) {
            console.error('Delete error:', error)
            showToast(error.message || t('failed_save_generic'), 'error')
        }
    }

    // Who it can be handed to, asked for when Reassign opens: undefined
    // while they load, null if they couldn't be.
    const [loaded, setLoaded] = useState<Assignable[] | null | undefined>(undefined)
    const [tries, setTries] = useState(0)
    const [retrying, setRetrying] = useState(false)
    const [newAssigneeIds, setNewAssigneeIds] = useState<string[]>(obligation.assignees?.map((a: any) => a.id) || [])
    useEffect(() => {
        if (!reassigning) return
        const queryParams = new URLSearchParams()
        queryParams.set('limit', '1000')
        if (obligation.companyId) queryParams.set('companyId', obligation.companyId)
        fetchRetrying(`/api/users?${queryParams.toString()}`)
            .then(res => {
                if (!res.ok) throw new Error(`Couldn't load the people (${res.status})`)
                return res.json()
            })
            .then(result => setLoaded(result?.data?.data || []))
            .catch(() => setLoaded(null))
            .finally(() => setRetrying(false))
    }, [reassigning, tries, obligation.companyId])
    const usersList: any[] = loaded ?? []
    // A team-scoped manager is not offered the company's Admins.
    const filtered = canManage && !companyWide('obligations.manage') ? usersList.filter((u: any) => !['ADMIN', 'SUPER_ADMIN'].includes(u.role)) : usersList
    const people = loaded === undefined || loaded === null ? loaded : filtered

    const handleReassign = async () => {
        if (newAssigneeIds.length === 0) return
        try {
            const res = await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                body: JSON.stringify({ assigneeIds: newAssigneeIds }),
                headers: { 'Content-Type': 'application/json' }
            })
            if (!res.ok) return fail(res, t('failed_save_generic'))
            setReassigning(false)
            router.refresh()
            showToast(t('obligation_reassigned'), 'success')
        } catch (error) {
            console.error('Reassign error', error)
            showToast(t('failed_save_generic'), 'error')
        }
    }

    // Someone it was for was deleted, and a manager settles it as done.
    const handleForceComplete = async () => {
        try {
            const res = await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'COMPLETED' })
            })
            if (!res.ok) return fail(res, t('failed_save_generic'))
            router.refresh()
            showToast(t('obligation_completed_success'), 'success')
        } catch (error) {
            console.error(error)
            showToast(t('failed_save_generic'), 'error')
        }
    }

    const handleRevert = async () => {
        try {
            const res = await fetch(`/api/obligations/${obligation.id}/revert`, { method: 'POST' })
            if (!res.ok) return fail(res, t('failed_revert_obligation'))
            setReverting(false)
            showToast(t('obligation_reverted_success'), 'success')
            router.refresh()
        } catch (e: any) {
            console.error(e)
            showToast(e.message || t('failed_revert_obligation'), 'error')
        }
    }

    const recurrence = obligation.recurrence ? RECURRENCE_STYLE[obligation.recurrence] : undefined
    const decidedBy = DECIDED.includes(obligation.status) && obligation.lastStatusUpdateBy
        ? t('list_status_by').replace('{name}', decidedByName(obligation.lastStatusUpdateBy))
        : undefined
    const names = (obligation.assignees ?? []).map((a: any) => `${a.firstName} ${a.lastName}`)
    const deleted = (obligation.assignees ?? []).filter((a: any) => a.status === 'DELETED')
    const working = !['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(obligation.status)

    const menu: MenuItem[] = [
        ...(userRole === 'SUPER_ADMIN' && ['APPROVED', 'COMPLETED', 'REJECTED', 'PENDING_CONFIRMATION'].includes(obligation.status)
            ? [{ key: 'revert', icon: ArrowCounterClockwiseIcon, label: t('return_to_in_progress'), onSelect: () => setReverting(true) }]
            : []),
        ...(mayManageThis
            ? [{ key: 'delete', icon: TrashIcon, label: t('delete_obligation_button'), danger: true, onSelect: () => setDeleting(true) }]
            : []),
    ]

    return (
        <Page>
            <PageHeader
                title={(
                    <span className="ui-title-with-badge">
                        <bdi>{obligation.title}</bdi>
                        <StatusBadge tone={taskStatusTone(obligation.status)}>{t(`status_${obligation.status.toLowerCase()}` as TranslationKey)}</StatusBadge>
                    </span>
                )}
                subtitle={decidedBy}
                back={{ href: '/dashboard/obligations', label: modules.label('obligations') }}
                // Handed in: the manager's decision.
                action={mayManageThis && obligation.status === 'PENDING_CONFIRMATION' && (
                    <>
                        <Button icon={XIcon} onClick={() => action.run('reject', handleReject)} disabled={action.running} busy={action.is('reject')}>{t('reject_button')}</Button>
                        <Button variant="primary" icon={CheckIcon} onClick={() => action.run('approve', handleApprove)} disabled={action.running} busy={action.is('approve')}>{t('approve_button')}</Button>
                    </>
                )}
            />

            {/* Someone it's for was deleted: a manager settles it. */}
            {deleted.length > 0 && canManage && !DECIDED.includes(obligation.status) && (
                <Card title={t('assignee_deleted_alert')}>
                    <p>{t('obligation_assignee_deleted_msg').replace('{name}', deleted.map((a: any) => `${a.firstName} ${a.lastName}`).join(locale === 'ar' ? '، ' : ', '))}</p>
                    <div className="ui-form-actions">
                        <Button variant="primary" icon={UserSwitchIcon} onClick={() => setReassigning(true)}>{t('reassign_button')}</Button>
                        <Button icon={CheckIcon} onClick={() => action.run('complete', handleForceComplete)} disabled={action.running} busy={action.is('complete')}>{t('mark_as_completed')}</Button>
                        {mayManageThis && <Button icon={TrashIcon} onClick={() => setDeleting(true)}>{t('delete_obligation_button')}</Button>}
                    </div>
                </Card>
            )}

            <Card
                title={t('obligation_details')}
                actions={menu.length > 0 && <RowMenu label={t('ui_more_actions_for').replace('{name}', obligation.title)} tooltip={t('ui_more_actions')} items={menu} />}
            >
                {obligation.description && <p className="ui-prose" dir="auto">{obligation.description}</p>}
                <Details items={[
                    { label: t('assigned_by'), value: creatorName ? <bdi>{creatorName}</bdi> : creatorUnknown ? t('assigned_by_unknown') : t('role_super_admin') },
                    { label: t('deadline_label'), value: <DueDate overdue={isOverdue}><SafeDate date={obligation.deadline} locale={locale} showTime /></DueDate> },
                    ...(recurrence ? [{ label: t('recurrence_label'), value: t(recurrence.labelKey as TranslationKey) }] : []),
                    { label: t('points_label_plural'), value: countOf(t, locale, obligation.difficulty ?? 0, 'pts') },
                    { label: t('assignees_label'), value: <bdi>{new Intl.ListFormat(locale === 'ar' ? 'ar' : 'en', { type: 'conjunction' }).format(names)}</bdi> },
                ]} />
            </Card>

            <Card title={t('attachments_label')}>
                {attachments.length > 0
                    ? (
                        <FileChips label={t('attachments_label')}>
                            {attachments.map(att => (
                                <FileChip key={att.url} name={fileName(att)} href={att.url} onRemove={mayRemove(att) ? () => setRemoving(att) : undefined} />
                            ))}
                        </FileChips>
                    )
                    : <p className="ui-hint">{t('no_attachments_msg')}</p>}
            </Card>

            {/* What its assignee hands in, while they're working on it. */}
            {!seesOthers && !['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(obligation.status) && (
                <Card title={t('obligation_your_submission')}>
                    <div className="ui-form">
                        {locked && <p className="ui-error" role="status">{t('overdue_obligation_alert_msg')}</p>}
                        <FilePicker label={t('ui_attach_files')} hint={t('obligation_files_hint')} accept={FILE_TYPES.join(',')} onFiles={handleFiles} disabled={locked || sending !== null} />
                        {pendingFiles.length > 0 && (
                            <FileChips label={t('ui_attach_files')}>
                                {pendingFiles.map((file, i) => (
                                    <FileChip key={`${file.name}-${i}`} name={file.name} size={file.size} onRemove={locked || sending ? undefined : () => setPendingFiles(prev => prev.filter((_, at) => at !== i))} />
                                ))}
                            </FileChips>
                        )}
                        <div className="ui-form-actions">
                            <Button variant="primary" onClick={() => handleUpload(false)} disabled={sending !== null} busy={sending === 'SUBMIT'}>
                                {sending === 'SUBMIT' ? t('submitting_obligation') : t('submit_obligation')}
                            </Button>
                            <Button onClick={() => handleUpload(true)} disabled={locked || sending !== null} busy={sending === 'DRAFT'}>
                                {sending === 'DRAFT' ? t('saving') : t('save_draft_obligation_button')}
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {/* Handed in or done with: its assignee is told where it stands. */}
            {!seesOthers && !working && obligation.status !== 'REJECTED' && (
                <Card title={t('obligation_your_submission')}>
                    <p className="ui-hint">{obligation.status === 'PENDING_CONFIRMATION' ? t('pending_confirmation_msg') : t('obligation_finalized_msg')}</p>
                </Card>
            )}

            <Dialog
                open={deleting}
                onClose={() => setDeleting(false)}
                title={t('delete_obligation_title')}
                actions={<>
                    <Button onClick={() => setDeleting(false)}>{t('cancel')}</Button>
                    <Button variant="danger" onClick={() => action.run('delete', handleDelete)} disabled={action.running} busy={action.is('delete')}>{t('delete')}</Button>
                </>}
            >
                <p>{t('delete_obligation_warning')}</p>
            </Dialog>

            <Dialog
                open={removing !== null}
                onClose={() => setRemoving(null)}
                title={removing ? t('ui_remove_file').replace('{name}', fileName(removing)) : ''}
                actions={<>
                    <Button onClick={() => setRemoving(null)}>{t('cancel')}</Button>
                    <Button variant="danger" onClick={() => removing && action.run('remove-file', () => handleRemoveAttachment(removing))} disabled={action.running} busy={action.is('remove-file')}>{t('remove')}</Button>
                </>}
            >
                <p>{t('obligation_remove_file_body')}</p>
            </Dialog>

            <Dialog
                open={reverting}
                onClose={() => setReverting(false)}
                title={t('return_to_in_progress')}
                actions={<>
                    <Button onClick={() => setReverting(false)}>{t('cancel')}</Button>
                    <Button variant="primary" onClick={() => action.run('revert', handleRevert)} disabled={action.running} busy={action.is('revert')}>{t('return_to_in_progress')}</Button>
                </>}
            >
                <p>{t('obligation_revert_body')}</p>
            </Dialog>

            <Dialog
                open={reassigning}
                onClose={() => setReassigning(false)}
                title={t('reassign_button')}
                actions={<>
                    <Button onClick={() => setReassigning(false)}>{t('cancel')}</Button>
                    <Button variant="primary" onClick={() => action.run('reassign', handleReassign)} disabled={newAssigneeIds.length === 0 || action.running} busy={action.is('reassign')}>{t('reassign_button')}</Button>
                </>}
            >
                <p>{t('obligation_reassign_msg')}</p>
                <AssigneeChecklist
                    people={people}
                    value={newAssigneeIds}
                    onChange={setNewAssigneeIds}
                    onRetry={() => { setRetrying(true); setTries(n => n + 1) }}
                    retrying={retrying}
                />
            </Dialog>
        </Page>
    )
}

