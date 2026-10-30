/**
 * A list's address with these changed: each one set, or cleared when it's
 * emptied, and the list back on its first page unless the page is what
 * changes.
 */
export function withChanges(address: string, changes: Record<string, string>): string {
    const params = new URLSearchParams(address)
    for (const [key, value] of Object.entries(changes)) {
        if (value) params.set(key, value)
        else params.delete(key)
    }
    if (!('page' in changes)) params.set('page', '1')
    return params.toString()
}
