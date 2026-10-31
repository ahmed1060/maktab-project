/**
 * Where an old request page's address lands on the one Requests page
 * (UI_PLAN.md §2.3): the same requests, on the same status, with the one a
 * notification picked out.
 */

/** Day off requests (part 2d): Day off, Waiting for a pending status and Done for a decided one. */
export function dayOffAddress(params: Record<string, string | undefined>): string {
    const query = new URLSearchParams({ kind: "dayOff" })
    const status = params.status
    if (status === "PENDING") query.set("show", "waiting")
    else if (status === "APPROVED" || status === "REJECTED") query.set("show", "done")
    if (params.highlight) query.set("highlight", params.highlight)
    return `/dashboard/requests?${query.toString()}`
}
