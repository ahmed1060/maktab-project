/**
 * The client and location filters on the Tasks and Costs pages
 * (CLIENTS_PLAN.md §3), as the address carries them: `?clientId=` (or
 * `none` for tasks with no client) and `?locationId=`. Each narrows what's
 * already in scope, never widens it.
 */

/** The client filter's "No client". */
export const NO_CLIENT = "none"

export function placeFilters(clientId?: string | null, locationId?: string | null): Record<string, unknown>[] {
    const where: Record<string, unknown>[] = []
    if (clientId === NO_CLIENT) where.push({ clientId: null })
    else if (clientId) where.push({ clientId })
    if (locationId) where.push({ locationId })
    return where
}

/** A location as the location filter lists it (LocationService.forFilters). */
export type FilterPlace = { id: string; name: string; clientId: string | null; needsPin: boolean; archived: boolean }

/**
 * The location filter's choices for the client picked: that client's and
 * the shared ones, only the shared ones with "No client", by name. Then the
 * archived ones, marked "· archived": their tasks and costs are still
 * theirs, to be found. A location with no pin has no task to find.
 */
export function locationFilterChoices(
    places: FilterPlace[],
    clientId: string,
    label: (place: FilterPlace) => string,
    archived: (label: string) => string,
): { value: string; label: string }[] {
    const offered = places.filter(p => !p.needsPin && (!clientId || !p.clientId || p.clientId === clientId))
    const named = (list: FilterPlace[], name: (label: string) => string) =>
        list.map(p => ({ value: p.id, label: name(label(p)) })).sort((a, b) => a.label.localeCompare(b.label))
    return [...named(offered.filter(p => !p.archived), l => l), ...named(offered.filter(p => p.archived), archived)]
}
