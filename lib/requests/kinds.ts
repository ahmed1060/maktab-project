/**
 * What the one Requests page's rows are (UI_PLAN.md §2.3): its kinds, tabs
 * and row, apart from the feed that reads them, which reaches the database,
 * so the page in the browser takes these alone (lib/client-bundle.test.ts).
 */

/** The kinds the page lists, in the order its filter offers them. */
export const REQUEST_KINDS = ["internal", "dayOff", "permission", "missingPunch", "overtime", "phone", "flagged", "nameChange", "role"] as const
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
    /** Whether whoever asked may take it back: permission hours and missing punches (§2.3, part 3). */
    mayWithdraw?: boolean
    /** A day off's own facts (§2.3, part 2c). Its `what` is its type. */
    dayOff?: DayOffFacts
    /** Permission hours' own facts (§2.3, part 3a). Its `what` is its type. */
    permission?: PermissionFacts
    /** A missing punch's own facts (§2.3, part 3b). Its `what` is its direction, if stated. */
    missingPunch?: MissingPunchFacts
    /** Overtime's own facts (§2.3, part 4a): a day's waiting, or a decision on it. */
    overtime?: OvertimeFacts
    /** Whether whoever decides it may stop it checking in: a check-in phone in use (§2.3, part 4b). */
    mayRevoke?: boolean
    /** A check-in phone's own facts (§2.3, part 4b). Its `what` is its model, if kept. */
    phone?: PhoneFacts
    /** A flagged check-in's own facts (§2.3, part 4c). Its `what` is its direction, if stated. */
    flagged?: FlaggedFacts
    /** A name change's own facts (§2.3, part 5a). Its `what` is the name it's for. */
    nameChange?: NameChangeFacts
    /** A role request's own facts (§2.3, part 5b). Its `what` is the role's name, as stored; `who` is whose role it would be. */
    role?: RoleFacts
}

export type DayOffFacts = {
    from: string
    to: string | null
    /** Once approved, the days taken, and whether from the balance or the salary. */
    deducted: number
    deductedFrom: "CREDIT" | "SALARY"
    rejectionReason: string | null
    /** The asker's balance, for whoever may decide it: what approving can take from. */
    credit: number | null
}

export type PermissionFacts = {
    /** The day, as a calendar day, and its hours as the clock reads them there. */
    date: string
    start: string
    end: string
    minutes: number
    rejectionReason: string | null
}

export type MissingPunchFacts = {
    /** The time claimed, as the clock on the wall read it: "2026-10-28T17:05". */
    at: string
    direction: "IN" | "OUT" | null
    rejectionReason: string | null
}

export type OvertimeFacts = {
    /** Whose and which day, as a decision on it is sent: the Super Admin's names the company. */
    companyId: string
    userId: string
    date: string
    /** A day waiting: its overtime, and when they came and left, as the clock on the wall read. */
    minutes: number | null
    firstIn: string | null
    lastOut: string | null
    /** A decision: what was approved, and the note it was made with. */
    approvedMinutes: number | null
    note: string | null
}

export type PhoneFacts = {
    platform: "ANDROID" | "IOS"
    model: string | null
    appVersion: string | null
    /** Whether it proved it runs the genuine app when it was registered. */
    attested: boolean
    /** While it waits: the check-ins it has recorded, held until it's decided. */
    held: number
    /** Why it was rejected or revoked, if someone said. */
    reason: string | null
    /** Revoked because a new phone of theirs was approved. */
    replaced: boolean
}

export type FlaggedFacts = {
    /** When, as the clock on the wall read: "2026-10-29T09:02". */
    at: string
    direction: "IN" | "OUT" | null
    /** Why it waits: OUTSIDE_AREA, IMPRECISE_LOCATION and the like. */
    reasons: string[]
    /** What the phone said and the server saw, as far as it said it: the place it was checked against, metres from it and the fix's accuracy, the address it came from, and the fix. */
    place: string | null
    distance: number | null
    accuracy: number | null
    ip: string | null
    latitude: number | null
    longitude: number | null
    /** The phone's model. */
    phone: string | null
    /** Why it was rejected, if someone said. */
    reason: string | null
    /** Whether this person may see the face photos of one whose face check failed, while it waits. */
    mayViewFace: boolean
}

export type NameChangeFacts = {
    /** The name it was asked from, and the one it's for. */
    from: string
    to: string
    /** The note it was decided with, if any. */
    note: string | null
}

/** A role, as lib/role-label.ts names it: a built-in one in the person's language. */
export type RoleName = { name: string; builtIn: string | null }

export type RoleFacts = {
    /** The role asked for; while it waits, the one they hold now. */
    to: RoleName
    now: RoleName | null
    /** Asked for as an acting role, until then (ROLES_PLAN.md §6.13). */
    actingUntil: string | null
    /** Who asked, and who decided: nobody named for the Super Admin. */
    by: string
    decidedBy: string | null
    /** The note it was decided with, if any. */
    note: string | null
}
