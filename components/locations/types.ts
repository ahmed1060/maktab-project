/** A location as the list and its form have it (LocationService's row). */
export type LocationItem = {
    id: string
    name: string
    isHq: boolean
    latitude: number | null
    longitude: number | null
    radiusMeters: number | null
    archivedAt: string | null
    createdAt: string
    client: { id: string; name: string } | null
    company: { name: string }
}

export type ClientOption = { id: string; name: string; company?: string }
