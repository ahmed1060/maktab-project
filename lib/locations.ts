/**
 * The places tasks happen at (CLIENTS_PLAN.md §2): what the Locations page,
 * each client's page and the service share.
 */

/** The check radius when a location has none of its own (§2.5). */
export const LOCATION_RADIUS_DEFAULT = 70
/** A radius's bounds, as a check-in place's. */
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

/** The radius a location's check uses: its own, or the default. */
export const radiusOf = (location: { radiusMeters: number | null }) => location.radiusMeters ?? LOCATION_RADIUS_DEFAULT

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
