'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckIcon, TrashIcon, WarningIcon, XIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import SafeDate from '@/components/SafeDate'
import { useFeatures } from '@/lib/features/useFeatures'
import SectionBoundary from './SectionBoundary'
import { useCan } from '@/lib/useCan'
import { Button, Card, Choice, Dialog, StatusBadge, type StatusTone } from '@/components/ui'
import type { TranslationKey } from '@/lib/translations'

// Where whoever does a task checked in, as a card of the building blocks.
// What it shows comes from `task`, which lives with the page; a check
// marked right or wrong is shown at once through `setTask`, and a location
// to delete is asked about by the page's own dialog.
interface TaskLocationHistorySectionProps {
    task: any
    setTask: (task: any) => void
    userId: string
    setLocationToDelete: (v: { index?: number, date?: string } | null) => void
    /** Past its deadline, for whoever does it: a location stays. */
    locked?: boolean
}

/** A lateness penalty's share of a day's pay. */
const PENALTIES: { amount: number; label: TranslationKey }[] = [
    { amount: 0.25, label: 'task_penalty_quarter' },
    { amount: 0.5, label: 'task_penalty_half' },
    { amount: 1, label: 'task_penalty_day' },
]

/**
 * How a check-in was checked. UNVERIFIED is not WRONG: it's the system
 * declining to decide, and coloured as a mismatch it would be the guess the
 * third state exists to remove, on the screen where a person acts on it.
 */
const VERIFIED: Record<string, { tone: StatusTone; label: TranslationKey }> = {
    CORRECT: { tone: 'good', label: 'verified_correct_title' },
    WRONG: { tone: 'problem', label: 'verified_wrong_title' },
    UNVERIFIED: { tone: 'waiting', label: 'verified_unclear_title' },
}

function TaskLocationHistorySectionBody({ task, setTask, userId, setLocationToDelete, locked = false }: TaskLocationHistorySectionProps) {
    const { t, locale } = useLanguage()
    const { can } = useCan()
    const { showToast } = useToast()
    const router = useRouter()
    const features = useFeatures()

    const [penalising, setPenalising] = useState(false)
    const [penaltyFor, setPenaltyFor] = useState('')
    const [penalty, setPenalty] = useState('')
    const [applyingPenalty, setApplyingPenalty] = useState(false)
    const [verifyingLocation, setVerifyingLocation] = useState<string | null>(null)

    const logs = Array.isArray(task.comments) ? task.comments : []
    const locations = logs.filter((l: any) => l.type === 'LOCATION_ADDED')
    if (locations.length === 0) return null

    // The penalty writes into payroll, so it belongs to HR even though it
    // lives on a task: hidden without the feature, rather than shown locked
    // in a page the company owns. The task's own penalty route takes it, for
    // the person picked (lib/features/routes.ts routes it to SALARY_ADJUSTMENTS).
    const mayPenalise = features.has('SALARY_ADJUSTMENTS') && can('tasks.penalize') && !['PENDING', 'IN_PROGRESS'].includes(task.status)
    const openPenalty = () => {
        setPenaltyFor(task.assignees?.length === 1 ? task.assignees[0].id : '')
        setPenalty('')
        setPenalising(true)
    }
    const applyPenalty = async () => {
        if (!penaltyFor || !penalty || applyingPenalty) return
        setApplyingPenalty(true)
        try {
            const res = await fetch(`/api/tasks/${task.id}/penalty`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: Number(penalty), userId: penaltyFor }),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                showToast(data.error || t('error_generic'), 'error')
                return
            }
            showToast(t('task_penalty_applied'), 'success')
            setPenalising(false)
            router.refresh()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setApplyingPenalty(false)
        }
    }

    const canVerify = can('tasks.review') && task.status === 'PENDING_CONFIRMATION'
    const canDelete = (!can('tasks.view') || task.assignees?.some((a: any) => a.id === userId)) && ['PENDING', 'IN_PROGRESS', 'REJECTED'].includes(task.status)

    const handleVerify = async (timestamp: string, status: 'CORRECT' | 'WRONG') => {
        const actionId = `${timestamp}-${status}`
        if (verifyingLocation) return
        setVerifyingLocation(actionId)
        const originalComments = task.comments
        try {
            const res = await fetch(`/api/tasks/${task.id}/locations`, {
                method: 'PUT',
                body: JSON.stringify({ timestamp, action: 'VERIFY', verificationStatus: status }),
                headers: { 'Content-Type': 'application/json' }
            })
            if (!res.ok) throw new Error('Failed to verify')
            // Shown once it's saved. task.comments is an array (F-12), not a JSON string.
            setTask({ ...task, comments: logs.map((c: any) => c.type === 'LOCATION_ADDED' && c.date === timestamp ? { ...c, verificationStatus: status, autoVerified: false } : c) })
            router.refresh()
        } catch (e) {
            console.error(e)
            setTask({ ...task, comments: originalComments })
            showToast(t('failed_verify_location'), 'error')
        } finally {
            setVerifyingLocation(null)
        }
    }

    return (
        <Card
            title={t('location_history_title')}
            actions={mayPenalise && <Button size="sm" icon={WarningIcon} onClick={openPenalty}>{t('task_penalty_button')}</Button>}
        >
            <ul className="ui-rows" aria-label={t('location_history_title')}>
                {locations.map((loc: any, i: number) => {
                    let displayLoc = loc.locationName || loc.location
                    let mapsLink: string | null = null
                    try {
                        if (loc.location.startsWith('{')) {
                            const d = JSON.parse(loc.location)
                            displayLoc = loc.locationName || d.address || d.name || `${d.latitude}, ${d.longitude}`
                            if (d.latitude && d.longitude) mapsLink = `https://www.google.com/maps?q=${d.latitude},${d.longitude}`
                        }
                    } catch { }
                    const verified = loc.verificationStatus ? VERIFIED[loc.verificationStatus] : undefined
                    return (
                        <li key={`${loc.date}-${i}`}>
                            <div className="ui-row">
                                <span className="ui-row-main">
                                    <span className="ui-item-title">
                                        {mapsLink
                                            ? <a href={mapsLink} target="_blank" rel="noopener noreferrer" className="ui-item-link"><bdi>{displayLoc}</bdi><span className="ui-visually-hidden"> {t('ui_opens_new_tab')}</span></a>
                                            : <bdi>{displayLoc}</bdi>}
                                    </span>
                                    {/* One span: a detail line lays its children side by side, so each part would wrap as a column of its own. */}
                                    <span className="ui-item-detail"><span><bdi>{loc.author}</bdi> · <SafeDate date={loc.date} locale={locale} /></span></span>
                                    {/* Why, for whoever settles it: a title is only read on hover, never on a phone. */}
                                    {canVerify && loc.verificationStatus === 'UNVERIFIED' && <span className="ui-item-detail">{t('verified_unclear_hint')}</span>}
                                </span>
                                <span className="ui-row-end">
                                    {verified && (
                                        <span title={loc.verificationStatus === 'UNVERIFIED' ? t('verified_unclear_hint') : undefined}>
                                            <StatusBadge tone={verified.tone}>{t(verified.label)}</StatusBadge>
                                        </span>
                                    )}
                                    {canVerify && (
                                        <>
                                            <Button size="sm" icon={CheckIcon} onClick={() => handleVerify(loc.date, 'CORRECT')} disabled={!!verifyingLocation} busy={verifyingLocation === `${loc.date}-CORRECT`}>{t('mark_correct_title')}</Button>
                                            <Button size="sm" icon={XIcon} onClick={() => handleVerify(loc.date, 'WRONG')} disabled={!!verifyingLocation} busy={verifyingLocation === `${loc.date}-WRONG`}>{t('mark_wrong_title')}</Button>
                                        </>
                                    )}
                                    {canDelete && !locked && task.status === 'IN_PROGRESS' && (loc.authorId === userId || can('tasks.edit')) && (
                                        <Button size="sm" variant="quiet" icon={TrashIcon} aria-label={t('delete_location_title')} title={t('delete_location_title')} onClick={() => setLocationToDelete({ date: loc.date })}>{t('delete')}</Button>
                                    )}
                                </span>
                            </div>
                        </li>
                    )
                })}
            </ul>

            <Dialog
                open={penalising}
                onClose={() => setPenalising(false)}
                title={t('task_penalty_title')}
                actions={<>
                    <Button onClick={() => setPenalising(false)}>{t('cancel')}</Button>
                    <Button variant="danger" onClick={() => { void applyPenalty() }} disabled={!penaltyFor || !penalty} busy={applyingPenalty}>{t('task_penalty_apply')}</Button>
                </>}
            >
                <p>{t('task_penalty_body')}</p>
                <Choice
                    legend={t('task_penalty_who')}
                    name="penalty-for"
                    value={penaltyFor}
                    onChange={setPenaltyFor}
                    options={(task.assignees ?? []).map((a: any) => ({ value: a.id, label: `${a.firstName} ${a.lastName}` }))}
                />
                <Choice
                    legend={t('task_penalty_amount')}
                    name="penalty-amount"
                    value={penalty}
                    onChange={setPenalty}
                    options={PENALTIES.map(p => ({ value: String(p.amount), label: t(p.label) }))}
                />
            </Dialog>
        </Card>
    )
}

/**
 * The section, inside a boundary. It used to wrap its own body in try/catch,
 * which caught errors in the JSX expressions but not in child components, and
 * reported nothing it caught — see SectionBoundary for the whole story. Same
 * behaviour for the reader: a malformed task log loses this section, not the
 * page.
 */
export default function TaskLocationHistorySection(props: TaskLocationHistorySectionProps) {
    return (
        <SectionBoundary name="TaskLocationHistorySection">
            <TaskLocationHistorySectionBody {...props} />
        </SectionBoundary>
    )
}
