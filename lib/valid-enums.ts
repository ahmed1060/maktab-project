import { TaskStatus, TaskPaymentStatus } from "@prisma/client"

// F-13: role/status-like fields are Postgres enums now, not free text — a
// filter value that isn't a real enum member makes Postgres reject the
// whole query ("invalid input value for enum") instead of the harmless
// zero-match a plain String column gave a garbage filter value. Anywhere
// a query-string value flows into one of these fields needs to check
// membership here first.
export const VALID_TASK_STATUSES: TaskStatus[] = [
    'PENDING',
    'IN_PROGRESS',
    'PENDING_CONFIRMATION',
    'APPROVED',
    'REJECTED',
    'COMPLETED',
]

export const VALID_TASK_PAYMENT_STATUSES: TaskPaymentStatus[] = ['PENDING_PAYMENT', 'PAID']

export function isValidTaskStatus(value: unknown): value is TaskStatus {
    return typeof value === 'string' && (VALID_TASK_STATUSES as string[]).includes(value)
}

export function isValidTaskPaymentStatus(value: unknown): value is TaskPaymentStatus {
    return typeof value === 'string' && (VALID_TASK_PAYMENT_STATUSES as string[]).includes(value)
}
