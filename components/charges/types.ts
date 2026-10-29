/** A charge as the Charged to clients tab lists it (CLIENTS_PLAN.md §6.4; /api/charges). */
export type ChargeRow = {
    id: string
    amount: number
    serviceFee: number
    description: string | null
    authorName: string | null
    receiptUrl: string | null
    notCharged: boolean
    collectedAt: string | null
    createdAt: string
    task: { id: string; title: string; client: { id: string; name: string } | null }
}
