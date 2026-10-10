/**
 * Map images from HERE (Raster Tile API v3), with the same key as the place
 * search (NEXT_PUBLIC_HERE_API_KEY), for the map that places a check-in
 * place's pin (components/PointPicker.tsx).
 *
 * "map" is the street map; "satellite" is imagery with street names on it,
 * which shows the building itself.
 */
export type HereStyle = 'map' | 'satellite'

const STYLE: Record<HereStyle, string> = { map: 'explore.day', satellite: 'explore.satellite.day' }

/** A Leaflet tile URL template ({z}/{x}/{y}) for this style, labelled in `lang`. */
export function hereTileUrl(style: HereStyle, lang: string, apiKey: string): string {
    const params = new URLSearchParams({ style: STYLE[style], size: '256', lang, apiKey })
    // Leaflet fills {z}/{x}/{y}; the rest must reach HERE as written.
    return `https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/${style === 'satellite' ? 'jpeg' : 'png8'}?${params}`
}

/*
 * The copyright notice. HERE asks for "© <year> HERE, <labels>", where the
 * labels are the data suppliers for the style showing, at this zoom, inside
 * the visible area. They come from GET /v3/copyright, which may be kept for
 * up to 24 hours:
 * https://docs.here.com/map-rendering/docs/required-copyright-notice
 */

/** Where the supplier list comes from. One answer covers every style. */
export function hereCopyrightUrl(apiKey: string): string {
    return `https://maps.hereapi.com/v3/copyright?${new URLSearchParams({ apiKey })}`
}

/** How long a fetched supplier list may be used. */
export const HERE_COPYRIGHT_MAX_AGE_MS = 24 * 60 * 60 * 1000

type Box = { west: number; south: number; east: number; north: number }
/** One supplier: shown between these zoom levels, inside these boxes (none: everywhere). */
export type HereCopyright = { label: string; copyrightText: string; minLevel: number; maxLevel: number; boxes: Box[] }
export type HereCopyrights = {
    /** Supplier lists by data source ("in", "sat", ...). */
    sources: Record<string, HereCopyright[]>
    /** For the tiles' resource ("base"), the sources each style draws on. */
    styles: Record<string, string[]>
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Reads the /v3/copyright answer. Null if it isn't one. */
export function parseHereCopyrights(json: unknown): HereCopyrights | null {
    if (!obj(json) || !obj(json.copyrights)) return null
    const sources: Record<string, HereCopyright[]> = {}
    for (const [key, list] of Object.entries(json.copyrights)) {
        if (!Array.isArray(list)) continue
        sources[key] = list.flatMap(c => {
            if (!obj(c) || typeof c.label !== 'string' || !c.label.trim()) return []
            const boxes = Array.isArray(c.boundingBoxes)
                ? c.boundingBoxes.filter((b): b is Box => obj(b) && num(b.west) && num(b.south) && num(b.east) && num(b.north))
                : []
            return [{
                label: c.label.trim(),
                copyrightText: typeof c.copyrightText === 'string' ? c.copyrightText : '',
                minLevel: num(c.minLevel) ? c.minLevel : 0,
                maxLevel: num(c.maxLevel) ? c.maxLevel : Infinity,
                boxes,
            }]
        })
    }
    const styles: Record<string, string[]> = {}
    const base = obj(json.resources) && obj(json.resources.base) && obj(json.resources.base.styles) ? json.resources.base.styles : {}
    for (const [style, keys] of Object.entries(base)) {
        if (Array.isArray(keys)) styles[style] = keys.filter((k): k is string => typeof k === 'string')
    }
    return { sources, styles }
}

/** Degrees east from `from` to `to`, 0 to 360. */
const eastward = (from: number, to: number) => ((to - from) % 360 + 360) % 360

/** The width of a box going east from west to east. -180 to 180 and 180 to -180 are both the whole world. */
const width = (west: number, east: number) => east - west >= 360 ? 360 : eastward(west, east) || (west === east ? 0 : 360)

/** Whether two longitude ranges meet, counting the wrap at 180°. */
function lngsMeet(a: { west: number; east: number }, b: { west: number; east: number }): boolean {
    const wa = width(a.west, a.east), wb = width(b.west, b.east)
    return eastward(a.west, b.west) <= wa || eastward(b.west, a.west) <= wb
}

/**
 * The suppliers to credit for this style, zoom and visible area, in the
 * order HERE lists them, each once.
 */
export function hereProviders(c: HereCopyrights, style: HereStyle, zoom: number, view: Box): HereCopyright[] {
    const level = Math.round(zoom)
    const seen = new Set<string>()
    const out: HereCopyright[] = []
    for (const key of c.styles[STYLE[style]] ?? []) {
        for (const p of c.sources[key] ?? []) {
            if (level < p.minLevel || level > p.maxLevel) continue
            const inView = p.boxes.length === 0 || p.boxes.some(b => b.south <= view.north && b.north >= view.south && lngsMeet(b, view))
            // "HERE" is already at the front of the notice.
            if (!inView || seen.has(p.label) || p.label.toUpperCase() === 'HERE') continue
            seen.add(p.label)
            out.push(p)
        }
    }
    return out
}

const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** What HERE's terms ask to be shown on the map, as HTML for Leaflet. Each supplier's long text shows on hover. */
export function hereAttribution(year: number, providers: HereCopyright[] = []): string {
    const labels = providers.map(p => p.copyrightText && p.copyrightText !== p.label
        ? `<span title="${html(p.copyrightText)}">${html(p.label)}</span>`
        : html(p.label))
    return [`&copy; ${year} HERE`, ...labels].join(', ')
}

let cached: { key: string; at: number; list: Promise<HereCopyrights | null> } | null = null

/**
 * The supplier list for this key, fetched once and kept in memory for up to
 * 24 hours. Null if it couldn't be had; the notice then shows HERE alone,
 * and the next call tries again.
 */
export function loadHereCopyrights(apiKey: string, now = Date.now()): Promise<HereCopyrights | null> {
    if (cached && cached.key === apiKey && now - cached.at < HERE_COPYRIGHT_MAX_AGE_MS) return cached.list
    const entry = {
        key: apiKey,
        at: now,
        list: fetch(hereCopyrightUrl(apiKey))
            .then(res => res.ok ? res.json() : null)
            .then(parseHereCopyrights)
            .catch(() => null),
    }
    entry.list.then(list => { if (!list && cached === entry) cached = null })
    cached = entry
    return entry.list
}
