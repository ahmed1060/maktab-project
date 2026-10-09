/**
 * Points on the map, for work locations (ATTENDANCE_PLAN.md §8.5, §9.4).
 */

/** "30.0444, 31.2357" as Google Maps copies it, or with a space, or "30.0444 31.2357". */
export function parsePoint(text: string): { latitude: number; longitude: number } | null {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text)
    if (!m) return null
    const latitude = Number(m[1]), longitude = Number(m[2])
    return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null
}

/** A fix vaguer than this, or than the place's own circle if that is wider, says nothing about being in it. */
export const MAX_ACCURACY_METERS = 50

const EARTH_RADIUS_M = 6_371_008.8

/** Metres between two points, along the earth's surface (haversine): exact enough at the scale of a building. */
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
    const rad = (d: number) => (d * Math.PI) / 180
    const dLat = rad(b.latitude - a.latitude)
    const dLng = rad(b.longitude - a.longitude)
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The point in Google Maps, in a new tab (or the Maps app on a phone). Uses
 * Google's documented Maps URL, which takes "lat,lng" as the search query.
 */
export function googleMapsLink(latitude: number, longitude: number): string {
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
}

/**
 * A point as the location field shows it: six decimals, about ten
 * centimetres, which is finer than any phone can tell.
 */
export function formatPoint(latitude: number, longitude: number): string {
    return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
}

/**
 * What to tell someone when their browser couldn't give their position, by
 * GeolocationPositionError code: 1 they (or the browser) said no, 2 the
 * device couldn't work it out, 3 it took too long.
 */
export function locateErrorKey(code: number): 'att_loc_here_denied' | 'att_loc_here_unavailable' | 'att_loc_here_timeout' {
    return code === 1 ? 'att_loc_here_denied' : code === 3 ? 'att_loc_here_timeout' : 'att_loc_here_unavailable'
}

/**
 * Whether a position that has just arrived should still fill the field: only
 * if it answers the latest request, and the field hasn't been edited since it
 * was asked for. A slow fix must not overwrite a point typed or picked
 * meanwhile. Edits are counted, not compared by their text: a point typed and
 * cleared again, or changed and changed back, leaves the same text, and the
 * fix overwrote what the person had last decided (review on #38).
 */
export function fixStillWanted(asked: { request: number; edits: number }, now: { request: number; edits: number }): boolean {
    return asked.request === now.request && asked.edits === now.edits
}
