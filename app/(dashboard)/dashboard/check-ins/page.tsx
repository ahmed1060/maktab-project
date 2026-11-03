'use client'

import { useState, type ReactNode } from 'react'
import useSWR from 'swr'
import {
    BuildingsIcon, CheckCircleIcon, CheckIcon, ClockIcon, DeviceMobileIcon, HourglassIcon, MapPinIcon, ProhibitIcon,
    UserFocusIcon, WarningCircleIcon, WarningIcon, XIcon,
} from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import { FlaggedFaceModal } from '@/components/FacePhoto'
import {
    Button, DataList, EmptyState, ItemTitle, ListCard, Page, PageHeader, RowMenu, Section, StatusBadge, type Column,
} from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { googleMapsLink } from '@/lib/attendance/geo'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import type { TranslationKey } from '@/lib/translations'
import { useBusyAction } from '@/lib/useBusyAction'
import { useViewer } from '@/lib/useCan'
import { RejectRequest, decideRequest, punchDay, punchTime } from '../requests/AttendanceDialogs'

/**
 * The Super Admin's check-in review (ATTENDANCE_PLAN.md §9.6, §13.7), on the
 * building blocks (UI_PLAN.md §5 step 5, Operations part 1).
 *
 * First, the check-ins waiting for them: those our app couldn't prove came
 * from itself, while attestation is in testing. Each shows where it was
 * taken and how it compares to the place, to accept or reject. The
 * companies' own flagged check-ins are on the Requests page instead.
 *
 * Then, across every company over the last 30 days, what came in, what was
 * flagged and what was refused, and why. A company with a sudden run of
 * refusals is under attack or has a broken app release.
 */

type Waiting = {
    id: string; companyName: string; name: string; at: string; direction: string | null; flagReasons: string[]
    checkIn: { latitude?: number; longitude?: number; distanceMeters?: number; accuracyMeters?: number; ip?: string | null; attestationReason?: string | null } | null
    workLocation: { name: string } | null; phone: { model: string | null; platform: string } | null
}
type Integrity = { companyId: string; name: string; checkIns: number; accepted: number; flagged: number; refused: number; refusedBy: Record<string, number>; flaggedBy: Record<string, number> }
type Review = { queue: Waiting[]; integrity: Integrity[]; days: number }

export default function CheckInReviewPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    // Who is looking comes from the layout on the first paint, so a Super
    // Admin never sees "Access restricted" while the session loads.
    const viewer = useViewer()
    const isSuperAdmin = viewer?.role === 'SUPER_ADMIN'
    const { data, error, isValidating, mutate } = useSWR(isSuperAdmin ? '/api/admin/check-ins' : null, fetcher)
    const review: Review | null = data?.data ?? null
    const action = useBusyAction()
    const [rejecting, setRejecting] = useState<Waiting | null>(null)
    const [faceOf, setFaceOf] = useState<Waiting | null>(null)

    if (!isSuperAdmin) return <AccessDenied />

    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const list = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(t('list_separator'))
    const platform = (w: Waiting) => t(w.phone?.platform === 'IOS' ? 'audit_value_IOS' : 'audit_value_ANDROID')

    const accept = (w: Waiting) => action.run(w.id, async () => {
        // A flagged check-in is accepted, as the Requests page accepts the companies' own.
        const refused = await decideRequest({ id: w.id, kind: 'flagged' }, true, null)
        if (refused) return showToast(t(refused), 'error')
        showToast(t('chk_accepted_toast'), 'success')
        await mutate()
    })

    // Why it waits, in a sentence: the reasons' words, the first capitalised, as on the Requests page.
    const why = (w: Waiting) => {
        const words = list(w.flagReasons.map(r => t(`att_flag_${r}` as TranslationKey)))
        return words.charAt(0).toLocaleUpperCase(locale) + words.slice(1)
    }
    // Where the phone said it was: how far and how exactly, the network it
    // was on, why the app wasn't verified (as the verifier said it, for
    // testing attestation), and the map.
    const where = (w: Waiting): ReactNode => {
        const c = w.checkIn
        const map = c?.latitude !== undefined && c.longitude !== undefined
            ? <a href={googleMapsLink(c.latitude, c.longitude)} target="_blank" rel="noopener noreferrer">{t('requests_flagged_map')}</a>
            : null
        const parts: ReactNode[] = [
            c?.distanceMeters !== undefined ? t('req_flagged_distance').replace('{n}', num(c.distanceMeters)) : null,
            c?.accuracyMeters !== undefined ? t('req_flagged_accuracy').replace('{n}', num(Math.round(c.accuracyMeters))) : null,
            c?.ip ? <bdi>{c.ip}</bdi> : null,
            c?.attestationReason ? t('chk_attest_reason').replace('{reason}', c.attestationReason) : null,
            map,
        ].filter(Boolean)
        return parts.length ? <span>{parts.map((p, i) => <span key={i}>{i > 0 && t('list_separator')}{p}</span>)}</span> : undefined
    }
    const when = (w: Waiting) => <span className="ui-nowrap">{punchDay(w.at, locale)}{t('list_separator')}{punchTime(w.at, locale)}</span>
    // In or out, and the place it was checked against: the company's own words, kept in their own direction.
    const place = (w: Waiting): ReactNode => {
        const direction = w.direction ? t(w.direction === 'IN' ? 'requests_flagged_in' : 'requests_flagged_out') : null
        if (!direction && !w.workLocation) return undefined
        return <span>{direction}{direction && w.workLocation && t('list_separator')}{w.workLocation && <bdi>{w.workLocation.name}</bdi>}</span>
    }
    const phone = (w: Waiting): ReactNode => w.phone ? (w.phone.model ? <bdi>{w.phone.model}</bdi> : platform(w)) : undefined
    const company = (name: string) => <bdi>{name}</bdi>

    const decisions = (w: Waiting) => (
        <span className="ui-row-actions">
            <Button size="sm" icon={CheckIcon} onClick={() => { void accept(w) }} disabled={action.running} busy={action.is(w.id)} aria-label={`${t('chk_accept')}: ${w.name}`}>{t('chk_accept')}</Button>
            <Button size="sm" icon={XIcon} onClick={() => setRejecting(w)} disabled={action.running} aria-label={`${t('chk_reject')}: ${w.name}`}>{t('chk_reject')}</Button>
            {/* The face photos, where the face check failed, as the Requests page offers them. */}
            {w.flagReasons.includes('FACE_UNVERIFIED') && (
                <RowMenu label={t('ui_more_actions_for').replace('{name}', w.name)} tooltip={t('ui_more_actions')}
                    items={[{ key: 'face', icon: UserFocusIcon, label: t('face_flag_see'), onSelect: () => setFaceOf(w) }]} />
            )}
        </span>
    )
    const waitingColumns: Column<Waiting>[] = [
        { key: 'company', header: t('chk_company'), cell: w => company(w.companyName) },
        { key: 'person', header: t('punch_person'), cell: w => <ItemTitle title={w.name} detail={phone(w)} /> },
        { key: 'when', header: t('punch_time'), cell: w => <ItemTitle title={when(w)} detail={place(w)} /> },
        { key: 'why', header: t('req_flagged_why'), cell: w => <ItemTitle title={why(w)} detail={where(w)} /> },
        { key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end', cell: decisions },
    ]

    // Why, the most first: "30 outside the place, 8 location too vague".
    const reasons = (by: Record<string, number>, prefix: 'att_flag_' | 'att_refusal_') =>
        list(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${num(n)} ${t(`${prefix}${r}` as TranslationKey)}`)) || undefined
    // Refusals stand out where a company has any: an attack, or a broken app release.
    const refused = (r: Integrity) => r.refused > 0 ? <StatusBadge tone="problem">{num(r.refused)}</StatusBadge> : <span className="ui-num">{num(r.refused)}</span>
    const accepted = (r: Integrity) => t('chk_accepted_n').replace('{n}', num(r.accepted))
    const countColumns: Column<Integrity>[] = [
        { key: 'company', header: t('chk_company'), cell: r => company(r.name) },
        { key: 'checkIns', header: t('chk_checkins'), align: 'end', cell: r => <ItemTitle title={<span className="ui-num">{num(r.checkIns)}</span>} detail={accepted(r)} /> },
        { key: 'flagged', header: t('chk_flagged'), align: 'end', cell: r => <ItemTitle title={<span className="ui-num">{num(r.flagged)}</span>} detail={reasons(r.flaggedBy, 'att_flag_')} /> },
        { key: 'refused', header: t('chk_refused'), align: 'end', cell: r => <ItemTitle title={refused(r)} detail={reasons(r.refusedBy, 'att_refusal_')} /> },
    ]

    let body: ReactNode
    if (!review) {
        body = error ? (
            <div className="ui-panel">
                <EmptyState icon={WarningCircleIcon} title={t('chk_load_failed')} detail={(error as SWRError).info?.error}
                    action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
            </div>
        ) : (
            <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        )
    } else {
        body = <>
            <Section title={t('chk_queue')}>
                <p className="ui-hint">{t('chk_queue_hint')}</p>
                <DataList
                    caption={t('chk_queue')}
                    columns={waitingColumns}
                    rows={review.queue}
                    rowKey={w => w.id}
                    empty={<EmptyState icon={CheckCircleIcon} title={t('chk_queue_none')} />}
                    card={w => (
                        <ListCard
                            title={w.name}
                            details={[
                                { icon: BuildingsIcon, text: company(w.companyName) },
                                { icon: ClockIcon, text: when(w) },
                                ...(place(w) ? [{ icon: MapPinIcon, text: place(w) }] : []),
                                ...(phone(w) ? [{ icon: DeviceMobileIcon, text: phone(w) }] : []),
                                { icon: WarningIcon, text: why(w) },
                                ...(where(w) ? [{ icon: MapPinIcon, text: where(w) }] : []),
                            ]}
                            foot={decisions(w)}
                        />
                    )}
                />
            </Section>
            <Section title={t('chk_integrity')}>
                <p className="ui-hint">{t('chk_integrity_hint').replace('{n}', num(review.days))}</p>
                <DataList
                    caption={t('chk_integrity')}
                    columns={countColumns}
                    rows={review.integrity}
                    rowKey={r => r.companyId}
                    empty={<EmptyState icon={DeviceMobileIcon} title={t('chk_integrity_none')} />}
                    card={r => (
                        <ListCard
                            title={company(r.name)}
                            status={r.refused > 0 ? <StatusBadge tone="problem">{`${t('chk_refused')} ${num(r.refused)}`}</StatusBadge> : undefined}
                            details={[
                                { icon: DeviceMobileIcon, text: `${t('chk_checkins')} ${num(r.checkIns)}${t('list_separator')}${accepted(r)}` },
                                { icon: WarningIcon, text: list([`${t('chk_flagged')} ${num(r.flagged)}`, reasons(r.flaggedBy, 'att_flag_')]) },
                                { icon: ProhibitIcon, text: list([`${t('chk_refused')} ${num(r.refused)}`, reasons(r.refusedBy, 'att_refusal_')]) },
                            ]}
                        />
                    )}
                />
            </Section>
        </>
    }

    return (
        <Page>
            <PageHeader title={t('chk_title')} subtitle={t('chk_hint')} />
            {body}

            {rejecting && (
                <RejectRequest
                    key={rejecting.id}
                    request={{ id: rejecting.id, kind: 'flagged' }}
                    question={t('requests_flagged_reject_question').replace('{name}', rejecting.name)
                        .replace('{time}', punchTime(rejecting.at, locale)).replace('{date}', punchDay(rejecting.at, locale))}
                    placeholder={t('requests_flagged_reject_placeholder')}
                    done={t('chk_rejected_toast')}
                    onClose={() => setRejecting(null)}
                    onDecided={() => { setRejecting(null); void mutate() }}
                />
            )}
            {faceOf && <FlaggedFaceModal punchId={faceOf.id} name={faceOf.name} onClose={() => setFaceOf(null)} />}
        </Page>
    )
}
