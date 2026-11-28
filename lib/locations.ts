/**
 * The places tasks happen at (CLIENTS_PLAN.md §2): what the Locations page,
 * each client's page and the service share.
 */

/** A radius's bounds, as a check-in place's. One left empty takes the system's distance (LATER_CHANGES_PLAN.md §7.22). */
export const LOCATION_RADIUS_MIN = 20
export const LOCATION_RADIUS_MAX = 5000
export const LOCATION_NAME_MAX = 100

/**
 * A location as it's shown (§2.2): "Client - Location", or a shared
 * location's name alone. The client's name is joined here, never stored in
 * the location's, so renaming a client renames all its locations.
 */
export function locationLabel(name: string, clientName?: string | null): string {
    return clientName ? `${clientName} - ${name}` : name
}

/** A location whose pin isn't placed yet: no task can use it until it is (§2.8). */
export const needsPin = (location: { latitude: number | null }) => location.latitude === null

/**
 * Locations by name, each name once (§2.7), for the Excel template's list:
 * where two would read the same ("Al Noor - Maadi branch" could be a shared
 * location's name too), the second and on are numbered, "Al Noor - Maadi
 * branch (2)". In the order given, so the same list numbers the same way.
 */
export function numberedLabels<T extends { label: string }>(list: T[]): (T & { label: string })[] {
    const seen = new Map<string, number>()
    const taken = new Set(list.map(l => l.label))
    return list.map(l => {
        const n = (seen.get(l.label) ?? 0) + 1
        seen.set(l.label, n)
        if (n === 1) return l
        // A number another location's name already ends with is skipped.
        let k = n
        while (taken.has(`${l.label} (${k})`)) k++
        seen.set(l.label, k)
        const label = `${l.label} (${k})`
        taken.add(label)
        return { ...l, label }
    })
}

/** What a location's row menu can offer, each its own part of what changes one (PR 377). */
export type LocationAction = 'edit' | 'hq' | 'archive' | 'restore' | 'delete'

/**
 * What a location's row menu offers (LATER_CHANGES_PLAN.md §2, PR 377):
 * editing it and making it its client's HQ with locations.edit, archiving it
 * or restoring it with locations.archive. A client's HQ is replaced, never
 * archived, a shared one is nobody's HQ, and an archived one is restored
 * before anything else.
 *
 * Deleting it, last, with locations.archive too, only where the server says
 * no task has used it (§7.21, PR 450): one a task has used is archived, and
 * one not known to be unused isn't offered it.
 */
export function locationActions(
    location: { archivedAt: unknown; isHq: boolean; client: unknown; inUse?: boolean },
    may: { edit: boolean; archive: boolean },
): LocationAction[] {
    const deletes = may.archive && !location.isHq && location.inUse === false
    if (location.archivedAt) return may.archive ? (deletes ? ['restore', 'delete'] : ['restore']) : []
    const actions: LocationAction[] = []
    if (may.edit) actions.push('edit')
    if (may.edit && location.client && !location.isHq) actions.push('hq')
    if (may.archive && !location.isHq) actions.push('archive')
    if (deletes) actions.push('delete')
    return actions
}
