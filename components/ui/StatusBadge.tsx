import type { ReactNode } from 'react'

/**
 * What a status means, which decides its colour (DESIGN.md §2.3). These never
 * follow the brand colour: a status has to mean the same in every company.
 */
export type StatusTone = 'neutral' | 'progress' | 'waiting' | 'good' | 'problem'

/** A status as a pill. The word is always there: colour is never the only signal. */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
    return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>
}

/** A task's status, by what it means. */
export const TASK_STATUS_TONE: Record<string, StatusTone> = {
    PENDING: 'neutral',
    IN_PROGRESS: 'progress',
    PENDING_CONFIRMATION: 'waiting',
    APPROVED: 'good',
    COMPLETED: 'good',
    REJECTED: 'problem',
}

export function taskStatusTone(status: string): StatusTone {
    return TASK_STATUS_TONE[status] ?? 'neutral'
}
