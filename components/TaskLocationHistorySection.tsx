'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import SafeDate from '@/components/SafeDate'
import TrashIcon from '@/components/TrashIcon'

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
    userRole: string
    userId: string
    setLocationToDelete: (v: { index?: number, date?: string } | null) => void
}

export default function TaskLocationHistorySection({ task, setTask, userRole, userId, setLocationToDelete }: TaskLocationHistorySectionProps) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const router = useRouter()

    const [showPenaltyUI, setShowPenaltyUI] = useState(false)
    const [selectedPenalty, setSelectedPenalty] = useState<number | null>(null)
    const [applyingPenalty, setApplyingPenalty] = useState(false)
    const [verifyingLocation, setVerifyingLocation] = useState<string | null>(null)

    if (!task.comments) return null
    try {
        const logs = Array.isArray(task.comments) ? task.comments : []
        if (!Array.isArray(logs)) return null
        const locations = logs.filter((l: any) => l.type === 'LOCATION_ADDED')
        if (locations.length === 0) return null

        return (
            <div style={{ marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem' }}>
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
                    {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && !['PENDING', 'IN_PROGRESS'].includes(task.status) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                            {showPenaltyUI && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', padding: '0.25rem 0.5rem', borderRadius: '2rem', border: '1px solid #e2e8f0' }}>
                                    {[0.25, 0.5, 1].map(amount => (
                                        <button
                                            key={amount}
                                            onClick={() => setSelectedPenalty(amount)}
                                            style={{
                                                width: '32px',
                                                height: '32px',
                                                borderRadius: '50%',
                                                border: selectedPenalty === amount ? '2px solid #ef4444' : '1px solid #cbd5e1',
                                                background: selectedPenalty === amount ? '#fee2e2' : 'white',
                                                color: selectedPenalty === amount ? '#991b1b' : '#64748b',
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
                                            background: '#ef4444',
                                            color: 'white',
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
                                    background: showPenaltyUI ? '#f1f5f9' : '#fee2e2',
                                    color: showPenaltyUI ? '#475569' : '#991b1b',
                                    border: '1px solid ' + (showPenaltyUI ? '#cbd5e1' : '#fca5a5'),
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
                                <span>⚠️</span> {locale === 'ar' ? 'خصم تأخير' : 'Lateness Penalty'}
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

                        const canVerify = ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && task.status === 'PENDING_CONFIRMATION'
                        const canDelete = (userRole === 'EMPLOYEE' || task.assignees?.some((a: any) => a.id === userId)) && ['PENDING', 'IN_PROGRESS', 'REJECTED'].includes(task.status)

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
                                showToast(t('failed_verify_location' as any) || 'Failed to update status', 'error')
                            } finally {
                                setVerifyingLocation(null)
                            }
                        }

                        return (
                            <div key={i} style={{ border: '1px solid #bae6fd', background: '#f0f9ff', borderRadius: '0.5rem', padding: '1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexDirection: 'row', gap: '1rem' }}>
                                    <div style={{ display: 'flex', gap: '0.75rem', flexDirection: 'row' }}>
                                        <span style={{ fontSize: '1.25rem' }}>📍</span>
                                        <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            {mapsLink ? <a href={mapsLink} target="_blank" rel="noreferrer" style={{ fontWeight: '600', color: '#0369a1', textDecoration: 'underline' }}>{displayLoc}</a> : <span style={{ fontWeight: '600', color: '#0c4a6e' }}>{displayLoc}</span>}
                                            <div style={{ fontSize: '0.75rem', color: '#0369a1', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                {(task.assignees?.length > 1) && (
                                                    <span style={{ background: '#e0f2fe', border: '1px solid #38bdf8', color: '#0369a1', padding: '0.1rem 0.4rem', borderRadius: '1rem', fontSize: '0.65rem', fontWeight: 'bold' }}>
                                                        {locale === 'ar' ? 'بواسطة:' : 'By:'} {loc.author}
                                                    </span>
                                                )}
                                                {!((task.assignees?.length > 1)) && <span>{loc.author}</span>}
                                                <span>• <SafeDate date={loc.date} locale={locale} /></span>
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexDirection: 'row' }}>
                                        {loc.verificationStatus && (
                                            <span style={{ fontSize: '0.75rem', fontWeight: '700', color: loc.verificationStatus === 'CORRECT' ? '#16a34a' : '#dc2626', background: loc.verificationStatus === 'CORRECT' ? '#dcfce7' : '#fee2e2', padding: '0.25rem 0.5rem', borderRadius: '0.25rem' }}>
                                                {loc.verificationStatus === 'CORRECT' ? t('verified_correct_title') : t('verified_wrong_title')}
                                            </span>
                                        )}
                                        {canVerify && (
                                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                <button
                                                    onClick={() => handleVerify('CORRECT')}
                                                    disabled={!!verifyingLocation}
                                                    style={{
                                                        background: '#dcfce7',
                                                        border: '1px solid #22c55e',
                                                        color: '#166534',
                                                        width: '32px',
                                                        height: '32px',
                                                        borderRadius: '50%',
                                                        cursor: verifyingLocation ? 'not-allowed' : 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center'
                                                    }}
                                                    title={t('mark_correct_title')}
                                                >
                                                    {verifyingLocation === `${loc.date}-CORRECT` ? <div className="animate-spin-local" style={{ width: '14px', height: '14px', border: '2px solid #166534', borderTopColor: 'transparent', borderRadius: '50%' }} /> : '✓'}
                                                </button>
                                                <button
                                                    onClick={() => handleVerify('WRONG')}
                                                    disabled={!!verifyingLocation}
                                                    style={{
                                                        background: '#fee2e2',
                                                        border: '1px solid #ef4444',
                                                        color: '#991b1b',
                                                        width: '32px',
                                                        height: '32px',
                                                        borderRadius: '50%',
                                                        cursor: verifyingLocation ? 'not-allowed' : 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center'
                                                    }}
                                                    title={t('mark_wrong_title')}
                                                >
                                                    {verifyingLocation === `${loc.date}-WRONG` ? <div className="animate-spin-local" style={{ width: '14px', height: '14px', border: '2px solid #991b1b', borderTopColor: 'transparent', borderRadius: '50%' }} /> : '✕'}
                                                </button>
                                            </div>
                                        )}
                                        {canDelete && task.status === 'IN_PROGRESS' && (loc.authorId === userId || ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) && (
                                            <button onClick={() => setLocationToDelete({ date: loc.date })} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '0.25rem', padding: '0.4rem', cursor: 'pointer', display: 'flex' }} title={t('delete_location_title')}>
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
    } catch { return null }
}
