import { formatPoint } from "@/lib/attendance/geo"

/**
 * The place search in a place on the map (DESIGN.md §5.3): what it asks
 * HERE's autosuggest, and the places it suggests from the answer.
 */

/** How many letters it waits for before it asks. */
export const PLACE_SEARCH_MIN = 3
/** The most places it suggests, as a name from a saved list has. */
export const PLACE_SEARCH_LIMIT = 8
/** Where it looks first: Cairo. */
const NEAR = "30.0444,31.2357"

/** A place to drop the pin on: its name, the rest of its address, and its point as the pin's field writes it. */
export type FoundPlace = { id: string; name: string; address: string | null; point: string }

/** Whether enough is typed to ask. */
export const searchable = (typed: string) => typed.trim().length >= PLACE_SEARCH_MIN

/** The question for HERE: places in Egypt, near Cairo first, in the language the text is typed in. */
export function placeSearchUrl(typed: string, apiKey: string): string {
    const text = typed.trim()
    const lang = /[؀-ۿ]/.test(text) ? "ar" : "en"
    return `https://autosuggest.search.hereapi.com/v1/autosuggest?q=${encodeURIComponent(text)}&at=${NEAR}&in=countryCode:EGY&lang=${lang}&limit=${PLACE_SEARCH_LIMIT}&apiKey=${apiKey}`
}

type Point = { lat?: unknown; lng?: unknown }
type Item = { id?: unknown; title?: unknown; address?: { label?: unknown }; position?: Point; access?: Point[] }

const pointOf = (at: Point | undefined) =>
    at && typeof at.lat === "number" && typeof at.lng === "number" && Number.isFinite(at.lat) && Number.isFinite(at.lng) ? formatPoint(at.lat, at.lng) : null

/**
 * The places in HERE's answer that have a point on the map: an entrance
 * stands in for a place with no position of its own. A suggestion to search
 * for a kind of place, such as "Pharmacy", has neither, and isn't one, as
 * picking it would drop no pin. Each is named by its title, its address
 * shown without the name it starts with, or not at all when it says
 * nothing more.
 */
export function foundPlaces(answer: unknown): FoundPlace[] {
    const items = (answer as { items?: unknown } | null | undefined)?.items
    if (!Array.isArray(items)) return []
    return items.flatMap((raw, i): FoundPlace[] => {
        if (!raw || typeof raw !== "object") return []
        const item = raw as Item
        const name = typeof item.title === "string" ? item.title.trim() : ""
        const point = pointOf(item.position) ?? pointOf(Array.isArray(item.access) ? item.access[0] : undefined)
        if (!name || !point) return []
        const label = typeof item.address?.label === "string" ? item.address.label.trim() : ""
        // HERE starts a place's address with its name, joined by a comma, an Arabic one in Arabic.
        const rest = [`${name}, `, `${name}، `].reduce((text, start) => (text.startsWith(start) ? text.slice(start.length) : text), label)
        return [{ id: typeof item.id === "string" ? item.id : String(i), name, address: rest && rest !== name ? rest : null, point }]
    })
}
