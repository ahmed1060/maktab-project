/**
 * What the one Requests page's rows are (UI_PLAN.md §2.3): its kinds, tabs
 * and row, apart from the feed that reads them, which reaches the database,
 * so the page in the browser takes these alone (lib/client-bundle.test.ts).
 */

/** The kinds the page lists, in the order its filter offers them. */
export const REQUEST_KINDS = ["internal"] as const
export type RequestKind = typeof REQUEST_KINDS[number]

export type RequestsTab = "mine" | "review"
export type RequestsShow = "waiting" | "done"

export type FeedRow = {
    kind: RequestKind
    id: string
    who: { id: string; name: string }
    /** What it's for: its title. */
    what: string
    detail: string | null
    asked: string
    started: string | null
    finished: string | null
    /** The kind's own status. */
    status: string
    /** What the list is in order of: when it was asked, or, once done, when it was. */
    sortAt: string
    mayDecide: boolean
    mayDelete: boolean
}
