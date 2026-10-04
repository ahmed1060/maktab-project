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
