/**
 * The bulk upload's locations (CLIENTS_PLAN.md §2.7): each row's Location
 * cell is found in the template's own Locations sheet, which keeps each
 * name's location in a hidden column, never by matching the name against
 * the company's locations. A name the sheet doesn't have exactly once is
 * flagged, never guessed. A row with none takes its client's HQ, as
 * picking a client does on the task form (§2.3).
 */

/** A location as the review screen has it: one of the company's in use. */
export type BulkPlace = { id: string; name: string; clientId: string | null; isHq: boolean; needsPin: boolean }

export type BulkLocationProblem = "required" | "not_in_list" | "other_client" | "needs_pin"

/**
 * The template's Locations sheet: each name and the locations it names. Its
 * first row is its heading, which names none: read as one, a location named
 * as the heading is ("Name", or "الاسم") named twice, and refused.
 */
export function sheetLocations(rows: unknown[][]): Map<string, string[]> {
    const names = new Map<string, string[]>()
    for (const [name, , id] of rows.slice(1)) {
        if (typeof name !== "string" || typeof id !== "string" || !name.trim() || !id.trim()) continue
        const key = name.trim()
        names.set(key, [...(names.get(key) ?? []), id.trim()])
    }
    return names
}

/** What's wrong with a row's location for its client, if anything. */
export function locationProblem(locationId: string | null, clientId: string | null, places: BulkPlace[]): BulkLocationProblem | null {
    if (!locationId) return "required"
    const place = places.find(p => p.id === locationId)
    // Archived or gone since the template was downloaded.
    if (!place) return "not_in_list"
    if (place.needsPin) return "needs_pin"
    if (place.clientId && place.clientId !== clientId) return "other_client"
    return null
}

/** A client's HQ, if a task can use it. */
export function hqOf(clientId: string | null, places: BulkPlace[]): string | null {
    const hq = clientId ? places.find(p => p.clientId === clientId && p.isHq) : undefined
    return hq && !hq.needsPin ? hq.id : null
}

/** A row's location: from its Location cell through the sheet, or its client's HQ. */
export function rowLocation(cell: unknown, clientId: string | null, sheet: Map<string, string[]>, places: BulkPlace[]): { locationId: string | null; problem: BulkLocationProblem | null } {
    const text = cell === null || cell === undefined ? "" : String(cell).trim()
    if (!text) {
        const hq = hqOf(clientId, places)
        return { locationId: hq, problem: hq ? null : "required" }
    }
    const ids = sheet.get(text)
    if (!ids || ids.length !== 1) return { locationId: null, problem: "not_in_list" }
    return { locationId: ids[0], problem: locationProblem(ids[0], clientId, places) }
}

/**
 * The location a row keeps when its client is changed on the review
 * screen: a shared one stays; otherwise the new client's HQ.
 */
export function locationForClient(current: string | null, clientId: string | null, places: BulkPlace[]): string | null {
    const place = places.find(p => p.id === current)
    if (place && !place.clientId) return current
    return hqOf(clientId, places)
}
