import { earliestDeadline } from './deadline'
import { locationForClient, locationProblem, type BulkPlace } from './bulk-locations'
import { TASK_DESCRIPTION_MAX, TASK_TITLE_MAX } from './new-task'
import type { TranslationKey } from './translations'

/**
 * The bulk upload of tasks (DESIGN.md §5.5, "Rows read from a file"): each
 * row as read from the file, what's wrong with it, and what's sent for the
 * ones with nothing wrong.
 *
 * What's wrong is worked out from the row whenever it's shown, never kept
 * with it: a fix is seen at once, and a deadline that turns too soon while
 * the review is open says so. What the file named and wasn't found, a
 * username, a client, a date, stays with the row until something is picked
 * in its place. The old review checked a row again on any change without
 * them, so a username that wasn't anyone's was dropped and the task created
 * without them, with nothing said.
 */

/** The fewest characters a task's title and description take, as the server has it. */
export const TASK_TITLE_MIN = 3
export const TASK_DESCRIPTION_MIN = 10
/** A task's difficulty is a whole number of points from 0 to this. */
export const TASK_DIFFICULTY_MAX = 10

export type BulkRow = {
    /** Its row in the file, to be found there, which also keys it in the list. */
    line: number
    title: string
    description: string
    clientId: string | null
    /** A client the file named that the company has none of, until one is picked. */
    unknownClient: string
    locationId: string | null
    /** What the file had for its location, until another is picked. */
    locationText: string
    assigneeIds: string[]
    /** Usernames the file had that no one has, until the row's people are picked. */
    unknownPeople: string[]
    /** Its deadline, as an ISO date and time, or empty. */
    deadline: string
    /** What the file had for its deadline when it wasn't a date, until one is picked. */
    unreadDeadline: string
    difficulty: number
}

/** A row's fields, in the order its form has them. */
export const BULK_FIELDS = ['title', 'description', 'client', 'location', 'assignees', 'deadline', 'difficulty'] as const
export type BulkField = typeof BULK_FIELDS[number]

/** What's wrong, and what the file had where that helps find it. */
export type BulkMistake = { key: TranslationKey; detail?: string }
export type BulkMistakes = Partial<Record<BulkField, BulkMistake>>

/** What's wrong with a row, field by field; nothing for a row that's right. */
export function rowMistakes(row: BulkRow, places: BulkPlace[], now: number): BulkMistakes {
    const mistakes: BulkMistakes = {}

    if (row.title.length < TASK_TITLE_MIN) mistakes.title = { key: 'bulk_title_short' }
    else if (row.title.length > TASK_TITLE_MAX) mistakes.title = { key: 'bulk_title_long' }

    if (row.description.length < TASK_DESCRIPTION_MIN) mistakes.description = { key: 'bulk_description_short' }
    else if (row.description.length > TASK_DESCRIPTION_MAX) mistakes.description = { key: 'bulk_description_long' }

    if (row.unknownClient) mistakes.client = { key: 'bulk_client_unknown', detail: row.unknownClient }

    // A name the template's list didn't have leaves the row with none: said
    // as what it is, with the name, rather than as one to pick.
    const problem = locationProblem(row.locationId, row.clientId, places)
    if (problem === 'required' && row.locationText) mistakes.location = { key: 'bulk_location_not_in_list', detail: row.locationText }
    else if (problem) mistakes.location = { key: `bulk_location_${problem}`, ...(row.locationText && { detail: row.locationText }) }

    if (row.unknownPeople.length > 0) mistakes.assignees = { key: 'bulk_assignees_unknown', detail: row.unknownPeople.join(', ') }
    else if (row.assigneeIds.length === 0) mistakes.assignees = { key: 'bulk_assignees_none' }

    const deadline = row.deadline ? new Date(row.deadline) : null
    if (row.unreadDeadline) mistakes.deadline = { key: 'bulk_deadline_unread', detail: row.unreadDeadline }
    else if (!deadline) mistakes.deadline = { key: 'bulk_deadline_none' }
    else if (Number.isNaN(deadline.getTime())) mistakes.deadline = { key: 'bulk_deadline_unread', detail: row.deadline }
    else if (deadline < earliestDeadline(now)) mistakes.deadline = { key: 'bulk_deadline_soon' }

    if (!Number.isInteger(row.difficulty) || row.difficulty < 0 || row.difficulty > TASK_DIFFICULTY_MAX) {
        mistakes.difficulty = { key: 'bulk_difficulty_range' }
    }

    return mistakes
}

/** A row's mistakes in the order its fields are in, for the list to say under its title. */
export function mistakesInOrder(mistakes: BulkMistakes): (BulkMistake & { field: BulkField })[] {
    return BULK_FIELDS.flatMap(field => {
        const mistake = mistakes[field]
        return mistake ? [{ field, ...mistake }] : []
    })
}

/** The row's people, picked: the usernames the file had that no one has are done with. */
export function withPeople(row: BulkRow, assigneeIds: string[]): BulkRow {
    return { ...row, assigneeIds, unknownPeople: [] }
}

/** The usernames no one has, left out: the row keeps the people who were found. */
export function withoutUnknownPeople(row: BulkRow): BulkRow {
    return { ...row, unknownPeople: [] }
}

/**
 * The row's client, picked, No client too: a shared location stays, and
 * otherwise it takes the client's HQ, as picking one on the task form does.
 */
export function withClient(row: BulkRow, clientId: string | null, places: BulkPlace[]): BulkRow {
    const locationId = locationForClient(row.locationId, clientId, places)
    return { ...row, clientId, unknownClient: '', locationId, locationText: locationId === row.locationId ? row.locationText : '' }
}

export function withLocation(row: BulkRow, locationId: string | null): BulkRow {
    return { ...row, locationId, locationText: '' }
}

export function withDeadline(row: BulkRow, deadline: string): BulkRow {
    return { ...row, deadline, unreadDeadline: '' }
}

/** A row removed from the review, and where it was, for Undo to put back. */
export type RemovedRow = { row: BulkRow; at: number }

export function withRowBack(rows: BulkRow[], removed: RemovedRow): BulkRow[] {
    const at = Math.min(removed.at, rows.length)
    return [...rows.slice(0, at), removed.row, ...rows.slice(at)]
}

/** A row with nothing wrong, as the server takes a task. */
export function rowToSend(row: BulkRow) {
    return {
        title: row.title,
        description: row.description,
        assigneeIds: row.assigneeIds,
        deadline: row.deadline,
        difficulty: row.difficulty,
        clientId: row.clientId ?? undefined,
        locationId: row.locationId,
    }
}

export type BulkTask = ReturnType<typeof rowToSend>

/**
 * Sends the tasks: how many the server created, as it counted them, since it
 * leaves out one it refuses, such as one for someone outside a Team Leader's
 * team; or what it said when it created none, null when it said nothing.
 */
export async function createTasks(tasks: BulkTask[]): Promise<{ created: number } | { refused: string | null }> {
    try {
        const res = await fetch('/api/tasks/bulk', {
            method: 'POST',
            body: JSON.stringify({ tasks }),
            headers: { 'Content-Type': 'application/json' },
        })
        const body = await res.json().catch(() => null)
        if (!res.ok) return { refused: typeof body?.error === 'string' && body.error ? body.error : null }
        const created = body?.data?.createdCount
        return { created: typeof created === 'number' ? created : tasks.length }
    } catch {
        return { refused: null }
    }
}
