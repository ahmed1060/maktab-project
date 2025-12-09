export function formatTaskStatus(status: string): string {
    switch (status) {
        case 'COMPLETED':
            return 'COMPLETED'
        case 'PENDING_CONFIRMATION':
            return 'PENDING APPROVAL'
        default:
            return status.replace(/_/g, ' ')
    }
}
