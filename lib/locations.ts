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
