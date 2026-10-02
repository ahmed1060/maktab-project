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
