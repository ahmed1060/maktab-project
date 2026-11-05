'use client'

import { Fragment, useRef, useState, type FormEvent, type ReactNode } from 'react'
import useSWR from 'swr'
import { CheckIcon, HourglassIcon, TrayIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react/ssr'
import { refusalOf } from '@/components/CompanyRolesCard'
import { useAssignableRoles } from '@/lib/useAssignableRoles'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { Button, Card, Dialog, DialogActions, EmptyState, Field, Row, RowMenu, Select, StatusBadge, TextArea, type MenuItem, type StatusTone } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { roleLabel } from '@/lib/role-label'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useBusyAction } from '@/lib/useBusyAction'
import { useFadingHighlight } from '@/lib/useFadingHighlight'
import type { TranslationKey } from '@/lib/translations'

/**
 * Role change requests (ROLES_PLAN.md §6.9), both sides of one channel: a
 * company's Admins ask and follow their requests; the Super Admin answers
 * them, having made the change in the company's settings.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, the Super Admin's pages part
 * 2a): asking is a card of labelled fields, what's wrong said under its field
 * on Send; the requests are rows in a card with the status to show in its
 * head, and declining asks for the reason in the building blocks' dialog.
 */
type ChangeRequest = {
    id: string
    description: string
    status: 'OPEN' | 'DONE' | 'DECLINED'
    response: string | null
    createdAt: string
    company: { name: string }
    role: { id: string; name: string; builtIn?: string | null } | null
    requestedBy: { firstName: string; lastName: string }
    respondedBy: { firstName: string; lastName: string } | null
}

const STATUS_TONE: Record<ChangeRequest['status'], StatusTone> = { OPEN: 'waiting', DONE: 'good', DECLINED: 'neutral' }
const STATUSES = ['OPEN', 'DONE', 'DECLINED'] as const

/** What's wrong with a request on Send, said under its field; null when it'll do. The server wants five letters. */
export function askError(description: string): TranslationKey | null {
    return description.trim().length < 5 ? 'role_changes_description_required' : null
}

/** What's wrong with a decline's response; null when there is one. */
export function responseError(response: string): TranslationKey | null {
    return response.trim().length < 3 ? 'role_changes_response_required' : null
}

export default function RoleChangeRequests({ side, highlight }: { side: 'company' | 'superAdmin'; highlight?: string | null }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const [status, setStatus] = useState(side === 'superAdmin' ? 'OPEN' : '')
    const { data, error, isValidating, mutate } = useSWR(`/api/role-change-requests${status ? `?status=${status}` : ''}`, fetcher)
    const requests: ChangeRequest[] | null = data ? data.data ?? [] : null
    const action = useBusyAction()
    const [declining, setDeclining] = useState<ChangeRequest | null>(null)
    const selected = useFadingHighlight(highlight ?? null, 10000)

    const answer = async (request: ChangeRequest, next: 'DONE' | 'DECLINED', response?: string): Promise<boolean> => {
        try {
            const res = await fetch(`/api/role-change-requests/${request.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: next, response }),
            })
            if (!res.ok) {
                showToast(await refusalOf(res, t('error_generic')), 'error')
                return false
            }
        } catch {
            showToast(t('error_generic'), 'error')
            return false
        }
        showToast(t('role_changes_answered'), 'success')
        await mutate()
        return true
    }

    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const day = (iso: string) => new Date(iso).toLocaleDateString(intl, { day: 'numeric', month: 'short', year: 'numeric' })
    const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`
    const roleName = (r: ChangeRequest) => roleLabel(r.role, t, t('role_changes_new_role'))
    // Each fact kept apart from the next, so a name can't swap places with
    // the words beside it in Arabic (company settings part 3c).
    const facts = (items: (string | null)[]) => (
        <span>{items.filter(Boolean).map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}<bdi>{x}</bdi></Fragment>)}</span>
    )

    // Marked done straight away; declining asks why.
    const menu = (r: ChangeRequest): MenuItem[] => [
        { key: 'done', label: t('role_changes_done'), icon: CheckIcon, disabled: action.running, onSelect: () => { void action.run(`done-${r.id}`, () => answer(r, 'DONE')) } },
        { key: 'decline', label: t('role_changes_decline'), icon: XIcon, danger: true, disabled: action.running, onSelect: () => setDeclining(r) },
    ]

    let list: ReactNode
    if (!requests) {
        list = error ? (
            <EmptyState icon={WarningCircleIcon} title={t('role_changes_load_failed')} detail={(error as SWRError).info?.error}
                action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
        ) : (
            <div role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        )
    } else if (requests.length === 0) {
        list = <EmptyState icon={TrayIcon} title={t('role_changes_empty')} />
    } else {
        list = (
            <ul className="ui-rows ui-rows-flush" aria-label={t('role_changes_list')}>
                {requests.map(r => (
                    <Row
                        key={r.id}
                        tone={selected === r.id ? 'selected' : undefined}
                        title={<><bdi>{roleName(r)}</bdi>{' '}<StatusBadge tone={STATUS_TONE[r.status]}>{t(`role_change_${r.status}` as TranslationKey)}</StatusBadge></>}
                        detail={facts([side === 'superAdmin' ? r.company.name : null, name(r.requestedBy), day(r.createdAt)])}
                        note={[
                            <bdi key="asked">{r.description}</bdi>,
                            r.response ? <Fragment key="response">{t('role_changes_response_line').split('{text}')[0]}<bdi>{r.response}</bdi>{t('role_changes_response_line').split('{text}')[1]}</Fragment> : null,
                        ]}
                        end={side === 'superAdmin' && r.status === 'OPEN' && (
                            // Named for the role and the company: two companies asking for "A new role" are told apart (audit on part 2a).
                            <RowMenu label={t('ui_more_actions_for').replace('{name}', `${roleName(r)}${t('list_separator')}${r.company.name}`)} tooltip={t('ui_more_actions')} items={menu(r)} />
                        )}
                    />
                ))}
            </ul>
        )
    }

    return (
        <>
            {side === 'company' && <AskCard onSent={() => { void mutate() }} />}

            <Card
                title={t('role_changes_list')}
                actions={
                    // One filter and no search: in the card's head (DESIGN.md §5.3).
                    <Field label={t('status')} hideLabel>{p => (
                        <Select {...p} name="status" value={status} onChange={e => setStatus(e.target.value)}
                            options={[...STATUSES.map(s => ({ value: s, label: t(`role_change_${s}` as TranslationKey) })), { value: '', label: t('all_statuses') }]} />
                    )}</Field>
                }
            >
                {list}
            </Card>

            {declining && (
                <DeclineDialog
                    request={declining}
                    onClose={() => setDeclining(null)}
                    onDecline={async response => {
                        const done = await answer(declining, 'DECLINED', response)
                        if (done) setDeclining(null)
                        return done
                    }}
                />
            )}
        </>
    )
}

/** Asking the Super Admin for a role change: which role, or a new one, and what's needed. */
function AskCard({ onSent }: { onSent: () => void }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const roles = useAssignableRoles()
    const formRef = useRef<HTMLFormElement>(null)
    const [roleId, setRoleId] = useState('')
    const [description, setDescription] = useState('')
    const [wrong, setWrong] = useState<TranslationKey | null>(null)
    const [sending, setSending] = useState(false)

    const ask = async (e: FormEvent) => {
        e.preventDefault()
        const found = askError(description)
        setWrong(found)
        if (found) { focusFirstWrong(formRef.current); return }
        setSending(true)
        try {
            const res = await fetch('/api/role-change-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roleId: roleId || null, description }),
            })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            showToast(t('role_changes_sent'), 'success')
            setDescription('')
            setRoleId('')
            onSent()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSending(false)
        }
    }

    return (
        <Card title={t('role_changes_ask')}>
            <p className="ui-card-note">{t('role_changes_ask_hint')}</p>
            <form ref={formRef} className="ui-form" noValidate onSubmit={ask}>
                <Field label={t('role_changes_role')}>{p => (
                    <Select {...p} name="roleId" value={roleId} onChange={e => setRoleId(e.target.value)}
                        options={[{ value: '', label: t('role_changes_new_role') }, ...roles.map(r => ({ value: r.id, label: roleLabel(r, t) }))]} />
                )}</Field>
                <Field label={t('role_changes_description')} error={wrong && t(wrong)}>{p => (
                    <TextArea {...p} name="description" rows={3} maxLength={2000} value={description}
                        onChange={e => { setDescription(e.target.value); setWrong(null) }} />
                )}</Field>
                <div>
                    <Button type="submit" variant="primary" busy={sending}>{t('role_changes_send')}</Button>
                </div>
            </form>
        </Card>
    )
}

/**
 * Declining a request: what was asked, in view, and why it's declined, which
 * the company sees. It stays open, its button busy, until it's done.
 */
export function DeclineDialog({ request, onClose, onDecline }: {
    request: ChangeRequest
    onClose: () => void
    onDecline: (response: string) => Promise<boolean>
}) {
    const { t } = useLanguage()
    const formRef = useRef<HTMLFormElement>(null)
    const [response, setResponse] = useState('')
    const [wrong, setWrong] = useState<TranslationKey | null>(null)
    const [busy, setBusy] = useState(false)

    const decline = async (e: FormEvent) => {
        e.preventDefault()
        const found = responseError(response)
        setWrong(found)
        if (found) { focusFirstWrong(formRef.current); return }
        setBusy(true)
        try {
            await onDecline(response.trim())
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t('role_changes_decline_title')}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={decline}>
                <p className="ui-dialog-note"><bdi>{request.description}</bdi></p>
                <Field label={t('role_changes_response')} error={wrong && t(wrong)}>{p => (
                    <TextArea {...p} name="response" rows={3} maxLength={2000} value={response}
                        onChange={e => { setResponse(e.target.value); setWrong(null) }} />
                )}</Field>
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="danger" busy={busy}>{t('role_changes_decline')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
