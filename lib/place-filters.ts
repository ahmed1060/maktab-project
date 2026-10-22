/**
 * The client and location filters on the Tasks and Costs pages
 * (CLIENTS_PLAN.md §3), as the address carries them: `?clientId=` (or
 * `none` for tasks with no client) and `?locationId=`. Each narrows what's
 * already in scope, never widens it.
 */

/** The client filter's "No client". */
export const NO_CLIENT = "none"

export function placeFilters(clientId?: string | null, locationId?: string | null): Record<string, unknown>[] {
    const where: Record<string, unknown>[] = []
    if (clientId === NO_CLIENT) where.push({ clientId: null })
    else if (clientId) where.push({ clientId })
    if (locationId) where.push({ locationId })
    return where
}
