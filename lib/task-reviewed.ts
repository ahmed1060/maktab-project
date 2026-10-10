/**
 * Whether a task has been reviewed: approved, completed or rejected. Only
 * reviewed work is paid for (TaskService.updatePaymentStatus); the screen
 * offers the payments from the same list, so it never shows one the server
 * refuses. A submission waiting for its review offered them, and each tap
 * failed (review on #6). No imports: the task page reads it.
 */
export const REVIEWED_TASK_STATUSES = ["APPROVED", "COMPLETED", "REJECTED"] as const

export function isReviewed(status: string): boolean {
    return (REVIEWED_TASK_STATUSES as readonly string[]).includes(status)
}
