'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import SafeDate from '@/components/SafeDate'
import TrashIcon from '@/components/TrashIcon'
import { useFeatures } from '@/lib/features/useFeatures'
import SectionBoundary from './SectionBoundary'
import { useCan } from '@/lib/useCan'

// F-23: extracted verbatim out of tasks/[id]/client.tsx. The lateness-
// penalty UI state (showPenaltyUI/selectedPenalty/applyingPenalty) and the
// per-row verify spinner (verifyingLocation) were only ever read inside
// this JSX, so they moved in as local state. `task`/`setTask` and
// `locationToDelete` stay with the parent instead — `task` is the one
// place that state actually lives (and setTask's optimistic update here
// needs to land there), and locationToDelete is also read by the Delete
// Location modal further down the page — so only the setter for that one
// is threaded through here.
interface TaskLocationHistorySectionProps {
    task: any
    setTask: (task: any) => void
    userId: string
    setLocationToDelete: (v: { index?: number, date?: string } | null) => void
    /** Past its deadline, for whoever does it: a location stays. */
    locked?: boolean
}

function TaskLocationHistorySectionBody({ task, setTask, userId, setLocationToDelete, locked = false }: TaskLocationHistorySectionProps) {
    const { t, locale } = useLanguage()
    const { can } = useCan()
    const { showToast } = useToast()
    const router = useRouter()
    const features = useFeatures()

    const [showPenaltyUI, setShowPenaltyUI] = useState(false)
    const [selectedPenalty, setSelectedPenalty] = useState<number | null>(null)
    const [applyingPenalty, setApplyingPenalty] = useState(false)
    const [verifyingLocation, setVerifyingLocation] = useState<string | null>(null)

    if (!task.comments) return null
        const logs = Array.isArray(task.comments) ? task.comments : []
        if (!Array.isArray(logs)) return null
        const locations = logs.filter((l: any) => l.type === 'LOCATION_ADDED')
        if (locations.length === 0) return null

        return (
            <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
                <style>{`
                @keyframes spin-local {
                    to { transform: rotate(360deg); }
                }
                .animate-spin-local {
                    animation: spin-local 1s linear infinite;
                }
            `}</style>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexDirection: 'row', gap: '1rem', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0 }}>{t('location_history_title')}</h3>
                    {/* The penalty writes into payroll, so it belongs to HR even
                        though it lives on a task. Hidden outright rather than
                        shown locked: this is an action inside a feature the
                        company already owns, and a locked button buried in a page
                        they own reads as a broken screen rather than an upsell.
                        The endpoint refuses it either way — see
                        lib/features/routes.ts, which routes this one child of
                        /api/tasks to SALARY_ADJUSTMENTS. */}
                    {features.has('SALARY_ADJUSTMENTS') && can('tasks.penalize') && !['PENDING', 'IN_PROGRESS'].includes(task.status) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                            {showPenaltyUI && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--surface-subtle)', padding: '0.25rem 0.5rem', borderRadius: '2rem', border: '1px solid var(--border)' }}>
                                    {[0.25, 0.5, 1].map(amount => (
                                        <button
                                            key={amount}
                                            onClick={() => setSelectedPenalty(amount)}
                                            style={{
                                                width: '32px',
                                                height: '32px',
                                                borderRadius: '50%',
                                                border: selectedPenalty === amount ? '2px solid var(--danger-solid)' : '1px solid var(--border-firm)',
                                                background: selectedPenalty === amount ? 'var(--danger-bg)' : 'var(--surface)',
                                                color: selectedPenalty === amount ? 'var(--danger-fg)' : 'var(--text-soft)',
                                                fontSize: '0.7rem',
                                                fontWeight: 'bold',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {amount}
                                        </button>
                                    ))}
                                    <button
                                        onClick={async () => {
                                            if (!selectedPenalty || applyingPenalty) return
                                            setApplyingPenalty(true)
                                            try {
                                                // The user didn't specify, but usually it's per task.
                                                // For now we'll apply it to the PRIMARY assignee (assigneeId) or all?
                                                // Usually these penalties are specific to who is late.
                                                // I'll apply it once for the task's main assignee for simplicity, or we should ask.
                                                // Actually, let's apply it for each current assignee if it's a team effort?
                                                // Apply it to all assignees or specific ones?
                                                // For now, applying to the first assignee found is not ideal, but we need a target.
                                                // Let's use the first one for simplicity or just skip if unclear.
                                                // Actually, we should probably let admin choose, but for now fallback to first assignee.
                                                const targetUserId = task.assignees?.[0]?.id;
                                                if (targetUserId) {
                                                    const res = await fetch(`/api/users/${targetUserId}/deduction`, {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ amount: selectedPenalty, userId: targetUserId }),
                                                    })

                                                    if (res.ok) {
                                                        showToast(t('update_success'), 'success')
                                                        setShowPenaltyUI(false)
                                                        setSelectedPenalty(null)
                                                        router.refresh()
                                                    } else {
                                                        throw new Error()
                                                    }
                                                }
                                            } catch {
                                                showToast(t('error_generic'), 'error')
                                            } finally {
                                                setApplyingPenalty(false)
                                            }
                                        }}
                                        disabled={!selectedPenalty || applyingPenalty}
                                        style={{
                                            padding: '0.25rem 0.75rem',
                                            borderRadius: '1rem',
                                            background: 'var(--danger-fill)',
                                            color: 'var(--text-on-accent)',
                                            fontSize: '0.75rem',
                                            fontWeight: 'bold',
                                            border: 'none',
                                            cursor: (selectedPenalty && !applyingPenalty) ? 'pointer' : 'not-allowed',
                                            opacity: (selectedPenalty && !applyingPenalty) ? 1 : 0.6
                                        }}
                                    >
                                        {applyingPenalty ? '...' : t('confirm')}
                                    </button>
                                </div>
                            )}
                            <button
                                onClick={() => setShowPenaltyUI(!showPenaltyUI)}
                                style={{
                                    background: showPenaltyUI ? 'var(--surface-sunk)' : 'var(--danger-bg)',
                                    color: showPenaltyUI ? 'var(--text-muted)' : 'var(--danger-fg)',
                                    border: '1px solid ' + (showPenaltyUI ? 'var(--border-firm)' : 'var(--danger-border-firm)'),
                                    padding: '0.4rem 0.8rem',
                                    borderRadius: '0.5rem',
                                    fontSize: '0.8rem',
                                    fontWeight: '700',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem'
                                }}
                            >
                                <span aria-hidden="true">⚠️</span> {locale === 'ar' ? 'خصم تأخير' : 'Lateness Penalty'}
                            </button>
                        </div>
                    )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {locations.map((loc: any, i: number) => {
                        let displayLoc = loc.locationName || loc.location
                        let mapsLink = null
                        try {
                            if (loc.location.startsWith('{')) {
                                const d = JSON.parse(loc.location)
                                displayLoc = loc.locationName || d.address || d.name || `${d.latitude}, ${d.longitude}`
                                if (d.latitude && d.longitude) mapsLink = `https://www.google.com/maps?q=${d.latitude},${d.longitude}`
                            }
                        } catch { }

                        const canVerify = can('tasks.review') && task.status === 'PENDING_CONFIRMATION'
                        const canDelete = (!can('tasks.view') || task.assignees?.some((a: any) => a.id === userId)) && ['PENDING', 'IN_PROGRESS', 'REJECTED'].includes(task.status)

                        const handleVerify = async (status: 'CORRECT' | 'WRONG') => {
                            const timestamp = loc.date
                            const actionId = `${timestamp}-${status}`
                            if (verifyingLocation === actionId) return

                            setVerifyingLocation(actionId)

                            // UI Logic
                            const originalComments = task.comments
                            try {
                                const currentComments = (Array.isArray(task.comments) ? task.comments : [])
                                const updatedComments = currentComments.map((c: any) => {
                                    if (c.type === 'LOCATION_ADDED' && c.date === timestamp) {
                                        return { ...c, verificationStatus: status, autoVerified: false }
                                    }
                                    return c
                                })

                                const res = await fetch(`/api/tasks/${task.id}/locations`, {
                                    method: 'PUT',
                                    body: JSON.stringify({ timestamp, action: 'VERIFY', verificationStatus: status }),
                                    headers: { 'Content-Type': 'application/json' }
                                })

                                if (!res.ok) throw new Error('Failed to verify')

                                // Update UI only AFTER successful database save.
                                // (F-12: task.comments is a real array now, not a
                                // JSON string — stringifying it here would make
                                // every other read on this page treat it as empty.)
                                setTask({ ...task, comments: updatedComments })

                                router.refresh()
                            } catch (e) {
                                console.error(e)
                                // Rollback on error
                                setTask({ ...task, comments: originalComments })
                                showToast(t('failed_verify_location'), 'error')
                            } finally {
                                setVerifyingLocation(null)
                            }
                        }

                        return (
                            <div key={i} style={{ border: '1px solid var(--info-bg-sky-firm)', background: 'var(--info-bg-sky)', borderRadius: '0.5rem', padding: '1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexDirection: 'row', gap: '1rem' }}>
                                    <div style={{ display: 'flex', gap: '0.75rem', flexDirection: 'row' }}>
                                        <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>📍</span>
                                        <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            {mapsLink ? <a href={mapsLink} target="_blank" rel="noreferrer" style={{ fontWeight: '600', color: 'var(--info-fg)', textDecoration: 'underline' }}>{displayLoc}</a> : <span style={{ fontWeight: '600', color: 'var(--info-fg-deepest)' }}>{displayLoc}</span>}
                                            <div style={{ fontSize: '0.75rem', color: 'var(--info-fg)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                {(task.assignees?.length > 1) && (
                                                    <span style={{ background: 'var(--info-bg)', border: '1px solid var(--info-solid-sky-light)', color: 'var(--info-fg)', padding: '0.1rem 0.4rem', borderRadius: '1rem', fontSize: '0.65rem', fontWeight: 'bold' }}>
                                                        {locale === 'ar' ? 'بواسطة:' : 'By:'} {loc.author}
                                                    </span>
                                                )}
                                                {!((task.assignees?.length > 1)) && <span>{loc.author}</span>}
                                                <span>• <SafeDate date={loc.date} locale={locale} /></span>
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexDirection: 'row' }}>
                                        {loc.verificationStatus && (() => {
                                            // Three states, not two. UNVERIFIED must not be coloured
                                            // as WRONG: it is the system declining to decide, and
                                            // showing it in the same red as a confirmed mismatch
                                            // would reintroduce the guess the third state exists to
                                            // remove — on the screen where a person acts on it.
                                            const unverified = loc.verificationStatus === 'UNVERIFIED'
                                            const correct = loc.verificationStatus === 'CORRECT'
                                            const fg = unverified ? 'var(--warn-fg)' : correct ? 'var(--ok-solid-hover)' : 'var(--danger-solid-hover)'
                                            const bg = unverified ? 'var(--warn-bg)' : correct ? 'var(--ok-bg)' : 'var(--danger-bg)'
                                            const label = unverified ? t('verified_unclear_title' as any) : correct ? t('verified_correct_title') : t('verified_wrong_title')
                                            return (
                                                <span
                                                    title={unverified ? t('verified_unclear_hint' as any) : undefined}
                                                    style={{ fontSize: '0.75rem', fontWeight: '700', color: fg, background: bg, padding: '0.25rem 0.5rem', borderRadius: '0.25rem' }}
                                                >
                                                    {label}
                                                </span>
                                            )
                                        })()}
                                        {canVerify && (
                                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                <button
                                                    onClick={() => handleVerify('CORRECT')}
                                                    disabled={!!verifyingLocation}
                                                    style={{
                                                        background: 'var(--ok-bg)',
                                                        border: '1px solid var(--ok-solid-alt)',
                                                        color: 'var(--ok-fg)',
                                                        width: '32px',
                                                        height: '32px',
                                                        borderRadius: '50%',
                                                        cursor: verifyingLocation ? 'not-allowed' : 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center'
                                                    }}
                                                    title={t('mark_correct_title')}
                                                    aria-label={t('mark_correct_title')}
                                                >
                                                    {verifyingLocation === `${loc.date}-CORRECT` ? <div className="animate-spin-local" style={{ width: '14px', height: '14px', border: '2px solid var(--ok-fg)', borderTopColor: 'transparent', borderRadius: '50%' }} /> : '✓'}
                                                </button>
                                                <button
                                                    onClick={() => handleVerify('WRONG')}
                                                    disabled={!!verifyingLocation}
                                                    style={{
                                                        background: 'var(--danger-bg)',
                                                        border: '1px solid var(--danger-solid)',
                                                        color: 'var(--danger-fg)',
                                                        width: '32px',
                                                        height: '32px',
                                                        borderRadius: '50%',
                                                        cursor: verifyingLocation ? 'not-allowed' : 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center'
                                                    }}
                                                    title={t('mark_wrong_title')}
                                                    aria-label={t('mark_wrong_title')}
                                                >
                                                    {verifyingLocation === `${loc.date}-WRONG` ? <div className="animate-spin-local" style={{ width: '14px', height: '14px', border: '2px solid var(--danger-fg)', borderTopColor: 'transparent', borderRadius: '50%' }} /> : '✕'}
                                                </button>
                                            </div>
                                        )}
                                        {canDelete && !locked && task.status === 'IN_PROGRESS' && (loc.authorId === userId || can('tasks.edit')) && (
                                            <button aria-label={t('delete_location_title')} onClick={() => setLocationToDelete({ date: loc.date })} style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg-strong)', border: 'none', borderRadius: '0.25rem', padding: '0.4rem', cursor: 'pointer', display: 'flex' }} title={t('delete_location_title')}>
                                                <TrashIcon size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
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
