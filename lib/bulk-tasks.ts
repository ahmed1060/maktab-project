import { cellText } from './attendance/punch-import'
import { earliestDeadline } from './deadline'
import { locationForClient, locationProblem, rowLocation, type BulkPlace } from './bulk-locations'
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

// ── Reading the file ──

/** The most tasks one file may hold, as the server takes them. */
export const BULK_MAX_ROWS = 50
/** The file's tasks start on this row, under the template's two heading rows. */
export const BULK_FIRST_ROW = 3

/** A row of the file's first sheet: its row's number, and its cells as cellToPrimitive gives them. */
export type SheetRow = { line: number; cells: unknown[] }

/** What the file's rows are found in. */
export type ReadContext = {
    /** Who can be assigned, found by username. */
    people: { id: string; username?: string | null }[]
    clients: { id: string; name: string }[]
    /** The template's Locations sheet (sheetLocations). */
    sheet: Map<string, string[]>
    places: BulkPlace[]
}

const empty = (cell: unknown) => cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '')
const text = (cell: unknown) => (cell === null || cell === undefined ? '' : String(cell).trim())
/** What a cell had, to say with a mistake. */
const shown = (cell: unknown) => (cell instanceof Date ? (Number.isNaN(cell.getTime()) ? '' : cell.toISOString()) : text(cell))

/** A real day, not the 31st of February rolled into March. */
function realDay(y: number, m: number, d: number): { y: number; m: number; d: number } | null {
    const date = new Date(y, m - 1, d)
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? { y, m, d } : null
}

/**
 * The day a date cell shows. A date cell and a serial number count in UTC,
 * so their day is read in UTC: on the browser's clock west of UTC, it was
 * the day before. Typed, it's the template's day first, d/m/yyyy, or the
 * year first, yyyy-mm-dd, in Arabic digits too, and nothing else: the
 * browser's own reading guesses, "1" as 1 January 2001 and "5.1.2027" as
 * the 1st of May.
 */
function dayOf(cell: unknown): { y: number; m: number; d: number } | null {
    if (cell instanceof Date) {
        return Number.isNaN(cell.getTime()) ? null : realDay(cell.getUTCFullYear(), cell.getUTCMonth() + 1, cell.getUTCDate())
    }
    if (typeof cell === 'number') {
        if (!Number.isFinite(cell)) return null
        // Excel counts days from 1900; 25569 is 1 January 1970.
        const date = new Date(Math.round((cell - 25569) * 86400) * 1000)
        return realDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
    }
    const written = cellText(String(cell))
    const dayFirst = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/.exec(written)
    if (dayFirst) return realDay(Number(dayFirst[4]), Number(dayFirst[3]), Number(dayFirst[1]))
    const yearFirst = /^(\d{4})([/.-])(\d{1,2})\2(\d{1,2})$/.exec(written)
    if (yearFirst) return realDay(Number(yearFirst[1]), Number(yearFirst[3]), Number(yearFirst[4]))
    return null
}

/** Before noon and after it, as written in English and in Arabic. */
const MORNING = ['AM', 'ص', 'صباحا', 'صباحًا']
const EVENING = ['PM', 'م', 'مساء', 'مساءً', 'مساءا']

/**
 * The time a time cell shows: a time cell's in UTC, a fraction of a day,
 * or typed, h:mm, with AM or PM, ص or م, in Arabic digits too.
 */
function timeOf(cell: unknown): { h: number; min: number } | null {
    if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : { h: cell.getUTCHours(), min: cell.getUTCMinutes() }
    if (typeof cell === 'number') {
        if (!Number.isFinite(cell) || cell < 0 || cell >= 1) return null
        const minutes = Math.round(cell * 24 * 60)
        return minutes >= 24 * 60 ? null : { h: Math.floor(minutes / 60), min: minutes % 60 }
    }
    const hm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(\S+))?$/.exec(cellText(String(cell)).toUpperCase())
    if (!hm || Number(hm[2]) > 59 || Number(hm[3] ?? 0) > 59) return null
    const min = Number(hm[2])
    const h = Number(hm[1])
    if (hm[4] === undefined) return h > 23 ? null : { h, min }
    const evening = EVENING.includes(hm[4])
    if ((!evening && !MORNING.includes(hm[4])) || h < 1 || h > 12) return null
    return { h: (h % 12) + (evening ? 12 : 0), min }
}

/**
 * A row's deadline from its date and time cells, on the browser's clock:
 * midnight when there's no time. What the file had is kept when it isn't a
 * date or a time, for the review to say, where a time that wasn't one was
 * taken as midnight.
 */
export function readDeadline(date: unknown, time: unknown): { deadline: string; unread: string } {
    if (empty(date)) return { deadline: '', unread: '' }
    const day = dayOf(date)
    if (!day) return { deadline: '', unread: shown(date) }
    const at = empty(time) ? { h: 0, min: 0 } : timeOf(time)
    if (!at) return { deadline: '', unread: shown(time) }
    return { deadline: new Date(day.y, day.m - 1, day.d, at.h, at.min).toISOString(), unread: '' }
}

/** Its difficulty: empty is 0, and one in words is kept as no number, for the review to say. */
function readPoints(cell: unknown): number {
    if (empty(cell)) return 0
    if (typeof cell === 'number') return cell
    const written = cellText(String(cell))
    return /^-?\d+$/.test(written) ? Number(written) : Number.NaN
}

/**
 * A row of the file, in the template's columns: title, description,
 * client, people, date, time, points, location. Its people are found by
 * username, written as the template's list has them, "Name (username)", or
 * typed, several split by commas.
 */
function readRow({ line, cells }: SheetRow, { people, clients, sheet, places }: ReadContext): BulkRow {
    const [title, description, clientCell, peopleCell, date, time, points, locationCell] = cells
    const usernames = text(peopleCell).split(',').map(piece => {
        const trimmed = piece.trim()
        const listed = /\(([^)]+)\)\s*$/.exec(trimmed)
        return listed ? listed[1].trim() : trimmed
    }).filter(Boolean)
    const assigneeIds: string[] = []
    const unknownPeople: string[] = []
    for (const username of usernames) {
        const person = people.find(p => p.username?.toLowerCase() === username.toLowerCase())
        if (!person) unknownPeople.push(username)
        else if (!assigneeIds.includes(person.id)) assigneeIds.push(person.id)
    }
    // A client's name is the company's alone, so it's found by name, case aside.
    const clientName = text(clientCell)
    const client = clientName ? clients.find(c => c.name.trim().toLowerCase() === clientName.toLowerCase()) : undefined
    const clientId = client?.id ?? null
    const locationText = text(locationCell)
    const { deadline, unread } = readDeadline(date, time)
    return {
        line,
        title: text(title),
        description: text(description),
        clientId,
        unknownClient: clientName && !client ? clientName : '',
        locationId: rowLocation(locationText, clientId, sheet, places).locationId,
        locationText,
        assigneeIds,
        unknownPeople,
        deadline,
        unreadDeadline: unread,
        difficulty: readPoints(points),
    }
}

/**
 * The file's rows as the review has them, from row 3, under the template's
 * headings. A row with anything in it is read, one with no title too, for
 * the review to say so: it was dropped with nothing said.
 */
export function readRows(sheetRows: SheetRow[], context: ReadContext): { rows: BulkRow[] } | { problem: 'none' | 'too_many' } {
    const filled = sheetRows.filter(r => r.line >= BULK_FIRST_ROW && r.cells.slice(0, 8).some(cell => !empty(cell)))
    if (filled.length === 0) return { problem: 'none' }
    if (filled.length > BULK_MAX_ROWS) return { problem: 'too_many' }
    return { rows: filled.map(row => readRow(row, context)) }
}

// ── The review ──

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
