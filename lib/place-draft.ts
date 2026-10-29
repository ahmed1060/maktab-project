import { formatPoint, parsePoint } from "@/lib/attendance/geo"
import { LOCATION_NAME_MAX, LOCATION_RADIUS_MAX, LOCATION_RADIUS_MIN } from "@/lib/locations"
import type { PlaceInput } from "@/lib/validations/location.schema"

/**
 * A place as its form holds it (DESIGN.md §5.3, "A place on the map"): its
 * name, its pin as "lat, lng" text (typed, pasted, found or picked), and its
 * radius as typed, empty for the default.
 */
export type PlaceDraft = { name: string; point: string; radius: string }

export const emptyPlace: PlaceDraft = { name: "", point: "", radius: "" }

/** A saved place's details, back in its form. */
export function draftOf(place: { name: string; latitude: number | null; longitude: number | null; radiusMeters: number | null }): PlaceDraft {
    return {
        name: place.name,
        point: place.latitude !== null && place.longitude !== null ? formatPoint(place.latitude, place.longitude) : "",
        radius: place.radiusMeters === null ? "" : String(place.radiusMeters),
    }
}

export type PlaceErrors = { name?: "required" | "long"; point?: "required" | "invalid"; radius?: "invalid" }

/** What the form holds as a place to save, or what's wrong with it, field by field. */
export function readPlace(draft: PlaceDraft): { place: PlaceInput | null; errors: PlaceErrors } {
    const errors: PlaceErrors = {}
    const name = draft.name.trim()
    if (!name) errors.name = "required"
    else if (name.length > LOCATION_NAME_MAX) errors.name = "long"
    const pin = parsePoint(draft.point)
    if (!draft.point.trim()) errors.point = "required"
    else if (!pin) errors.point = "invalid"
    const typed = draft.radius.trim()
    const radius = typed === "" ? null : Number(typed)
    if (radius !== null && !(Number.isInteger(radius) && radius >= LOCATION_RADIUS_MIN && radius <= LOCATION_RADIUS_MAX)) errors.radius = "invalid"
    if (Object.keys(errors).length || !pin) return { place: null, errors }
    return { place: { name, latitude: pin.latitude, longitude: pin.longitude, radiusMeters: radius }, errors }
}

/** The pin in a map link the place search gives ("?q=lat,lng"), if it has one. */
export function pinOfLink(link: string): string | null {
    const m = /[?&](?:q|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(link)
    if (!m) return null
    const pin = parsePoint(`${m[1]}, ${m[2]}`)
    return pin ? formatPoint(pin.latitude, pin.longitude) : null
}
