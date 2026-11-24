import { locationLabel } from './locations'
import { clientName, type ClientName } from './client-list'
import type { Locale } from './translations'

/**
 * A task's location as it was typed before locations (CLIENTS_PLAN.md §2),
 * kept with its map link as JSON on some tasks.
 */
export function parseTaskLocation(text: string): { name: string; link: string } {
    if (!text) return { name: '', link: '' }
    try {
        if (text.startsWith('{')) {
            const parsed = JSON.parse(text)
            return { name: parsed.name || '', link: parsed.link || '' }
        }
    } catch (e) { console.error('[LOCATION_PARSE_FAIL]', e) }
    return { name: text, link: '' }
}

type Placed = {
    client?: ClientName | null
    place?: { name: string; client?: ClientName | null } | null
    location?: string | null
}

/**
 * Where a task is done, as the line under its title in a list (DESIGN.md
 * §5.4): "Client - Location", a location with no client alone, the text
 * typed before locations, or its client with neither. Empty with none. The
 * client in the page's language, or the one it has (PR 413).
 */
export function placeLine(task: Placed, locale: Locale): string {
    const named = task.place?.client ?? task.client
    const client = named ? clientName(named, locale) : undefined
    const name = task.place?.name ?? parseTaskLocation(task.location ?? '').name
    return name ? locationLabel(name, client) : client ?? ''
}
