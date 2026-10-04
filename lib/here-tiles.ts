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

/** What HERE's terms ask to be shown on the map. */
export function hereAttribution(year: number): string {
    return `&copy; ${year} HERE`
}
