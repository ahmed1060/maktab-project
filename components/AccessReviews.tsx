'use client'

import { Fragment, useRef, useState, type FormEvent, type ReactNode } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { HourglassIcon, ShieldCheckIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { refusalOf } from '@/components/CompanyRolesCard'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { Button, Card, Dialog, DialogActions, EmptyState, Field, Row, Select, StatusBadge, TextArea } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { isPermission, type Scope } from '@/lib/permissions/catalogue'
import { permissionLabelKey, scopeLabelKey } from '@/lib/permissions/matrix'
import { roleLabel } from '@/lib/role-label'
import { useBusyAction } from '@/lib/useBusyAction'
import { useFadingHighlight } from '@/lib/useFadingHighlight'
import type { TranslationKey } from '@/lib/translations'

/**
 * Periodic access reviews (ROLES_PLAN.md §6.14): each review's lines — who
 * holds a sensitive permission, through which role — with Confirm or Request
 * change on each. For a company's Admins, their company's; for the Super
 * Admin, every company's, open ones first. Nobody answers their own line.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, the Super Admin's pages part
 * 2a): one card with the status to show in its head, each review a part of
 * it with its lines as rows, and a change asked for in the building blocks'
 * dialog with the line in view.
 */

type Person = { firstName: string; lastName: string }
type Line = {
    id: string; userId: string | null; userName: string; permission: string; scope: string; roleName: string; roleBuiltIn: string | null
    decision: 'CONFIRMED' | 'CHANGE_REQUESTED' | null; note: string | null
    answeredBy: Person | null; answeredBySuperAdmin: Person | null
}
type Review = { id: string; status: 'OPEN' | 'COMPLETED'; createdAt: string; company: { name: string }; lines: Line[] }

/** What's wrong with a change asked for; null when it says what. */
export function reasonError(reason: string): TranslationKey | null {
    return reason.trim().length < 3 ? 'access_review_change_reason_required' : null
}

/** A line's permission and role in words, as its facts and its dialog say them. */
function useLineWords() {
    const { t } = useLanguage()
    return {
        permission: (l: Line) => isPermission(l.permission) ? t(permissionLabelKey(l.permission)) : l.permission,
        scope: (l: Line) => t(scopeLabelKey(l.scope as Scope)),
        role: (l: Line) => roleLabel({ name: l.roleName, builtIn: l.roleBuiltIn }, t),
    }
}

export default function AccessReviews({ side, highlight }: { side: 'company' | 'superAdmin'; highlight?: string | null }) {
    const { t, locale } = useLanguage()
    const action = useBusyAction()
    const { showToast } = useToast()
    const { data: session } = useSession()
    const [status, setStatus] = useState<'OPEN' | ''>('OPEN')
    const [changing, setChanging] = useState<Line | null>(null)
    const { data, error, isValidating, mutate } = useSWR(`/api/access-reviews${status ? `?status=${status}` : ''}`, fetcher)
    const reviews: Review[] | null = data ? data.data ?? [] : null
    const selected = useFadingHighlight(highlight ?? null, 10000)
    const words = useLineWords()

    const answer = async (line: Line, decision: 'CONFIRMED' | 'CHANGE_REQUESTED', note?: string): Promise<boolean> => {
        try {
            const res = await fetch(`/api/access-reviews/lines/${line.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision, note }),
            })
            if (!res.ok) {
                showToast(await refusalOf(res, t('error_generic')), 'error')
                return false
            }
        } catch {
            showToast(t('error_generic'), 'error')
            return false
        }
        showToast(t('access_review_answered'), 'success')
        await mutate()
        return true
    }

    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const day = (iso: string) => new Date(iso).toLocaleDateString(intl, { day: 'numeric', month: 'short', year: 'numeric' })
    const number = (n: number) => n.toLocaleString(intl)
    const name = (p: Person | null) => p ? `${p.firstName} ${p.lastName}` : null
    // Each fact kept apart from the next, so a name can't swap places with
    // the words beside it in Arabic (company settings part 3c).
    const facts = (items: (string | null)[]) => (
        <span>{items.filter(Boolean).map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}<bdi>{x}</bdi></Fragment>)}</span>
    )
    const heading = (review: Review) => {
        const date = day(review.createdAt)
        if (side !== 'superAdmin') return t('access_review_opened').replace('{date}', date)
        const [before, after] = t('access_review_company_opened').replace('{date}', date).split('{company}')
        return <>{before}<bdi>{review.company.name}</bdi>{after}</>
    }

    /** What's at a line's end: how it was answered, Confirm and Request change, or that it's someone else's to answer. */
    const end = (line: Line) => {
        if (line.decision) {
            return line.decision === 'CONFIRMED'
                ? <StatusBadge tone="good">{t('access_review_confirmed')}</StatusBadge>
                : <StatusBadge tone="waiting">{t('access_review_change_requested')}</StatusBadge>
        }
        if (side === 'company' && line.userId === session?.user?.id) return <span className="ui-hint">{t('access_review_own_line')}</span>
        // Named for the line, as a row's menu is: a screen reader's list of buttons says whose.
        const named = `${line.userName}${t('list_separator')}${words.permission(line)}`
        return <>
            <Button size="sm" aria-label={t('access_review_confirm_for').replace('{line}', named)} disabled={action.running} busy={action.is(`confirm-${line.id}`)}
                onClick={() => { void action.run(`confirm-${line.id}`, () => answer(line, 'CONFIRMED')) }}>
                {t('access_review_confirm')}
            </Button>
            <Button size="sm" variant="quiet" aria-label={t('access_review_change_for').replace('{line}', named)} disabled={action.running} onClick={() => setChanging(line)}>
                {t('access_review_change')}
            </Button>
        </>
    }

    let body: ReactNode
    if (!reviews) {
        body = error ? (
            <EmptyState icon={WarningCircleIcon} title={t('access_review_load_failed')} detail={(error as SWRError).info?.error}
                action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
        ) : (
            <div role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        )
    } else if (reviews.length === 0) {
        body = <EmptyState icon={ShieldCheckIcon} title={t('access_review_empty')} />
    } else {
        body = reviews.map(review => {
            const remaining = review.lines.filter(l => !l.decision).length
            const title = heading(review)
            return (
                <section key={review.id} aria-labelledby={`review-${review.id}`}>
                    <h3 className="ui-subsection-title" id={`review-${review.id}`}>
                        {title}{' '}
                        {review.status === 'COMPLETED'
                            ? <StatusBadge tone="good">{t('access_review_completed')}</StatusBadge>
                            : <StatusBadge tone="waiting">{t('access_review_remaining').replace('{count}', number(remaining))}</StatusBadge>}
                    </h3>
                    <ul className="ui-rows ui-rows-flush">
                        {review.lines.map(line => (
                            <Row
                                key={line.id}
                                tone={selected === review.id ? 'selected' : undefined}
                                title={<bdi>{line.userName}</bdi>}
                                detail={facts([
                                    words.permission(line), words.scope(line), words.role(line),
                                    line.decision ? (name(line.answeredBy ?? line.answeredBySuperAdmin) && t('access_review_answered_by').replace('{name}', name(line.answeredBy ?? line.answeredBySuperAdmin)!)) : null,
                                ])}
                                note={line.note && <bdi>{line.note}</bdi>}
                                end={end(line)}
                            />
                        ))}
                    </ul>
                </section>
            )
        })
    }

    return (
        <>
            <Card
                title={t('access_review_list')}
                actions={
                    // One filter and no search: in the card's head (DESIGN.md §5.3).
                    <Field label={t('status')} hideLabel>{p => (
                        <Select {...p} name="status" value={status} onChange={e => setStatus(e.target.value as 'OPEN' | '')}
                            options={[{ value: 'OPEN', label: t('access_review_open') }, { value: '', label: t('all_statuses') }]} />
                    )}</Field>
                }
            >
                {body}
            </Card>

            {changing && (
                <ChangeLineDialog
                    line={changing}
                    onClose={() => setChanging(null)}
                    onRequest={async reason => {
                        const done = await answer(changing, 'CHANGE_REQUESTED', reason)
                        if (done) setChanging(null)
                        return done
                    }}
                />
            )}
        </>
    )
}

/**
 * Asking for a line's access to change: the line in view, and what should
 * change and why. It stays open, its button busy, until it's done.
 */
export function ChangeLineDialog({ line, onClose, onRequest }: {
    line: Line
    onClose: () => void
    onRequest: (reason: string) => Promise<boolean>
}) {
    const { t } = useLanguage()
    const words = useLineWords()
    const formRef = useRef<HTMLFormElement>(null)
    const [reason, setReason] = useState('')
    const [wrong, setWrong] = useState<TranslationKey | null>(null)
    const [busy, setBusy] = useState(false)

    const request = async (e: FormEvent) => {
        e.preventDefault()
        const found = reasonError(reason)
        setWrong(found)
        if (found) { focusFirstWrong(formRef.current); return }
        setBusy(true)
        try {
            await onRequest(reason.trim())
        } finally {
            setBusy(false)
        }
    }

    const facts = [line.userName, words.permission(line), words.role(line)]
    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t('access_review_change')}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={request}>
                <p>{facts.map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}<bdi>{x}</bdi></Fragment>)}</p>
                <Field label={t('access_review_change_reason')} error={wrong && t(wrong)}>{p => (
                    <TextArea {...p} name="reason" rows={3} maxLength={1000} value={reason}
                        onChange={e => { setReason(e.target.value); setWrong(null) }} />
                )}</Field>
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('access_review_change')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
