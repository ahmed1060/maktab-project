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

/**
 * What a list's filters show, ahead of its address, which changes only once
 * its navigation lands: the address as last changed, and those sent whose
 * navigation hasn't landed yet.
 */
export type Picked = { latest: string; sent: string[] }

/** What's picked once these change, built on the last change rather than on the address, which lags behind it. */
export function changed(picked: Picked, changes: Record<string, string>): Picked {
    const latest = withChanges(picked.latest, changes)
    return { latest, sent: [...picked.sent, latest] }
}

/**
 * What's picked once the address becomes this. One it sent, landing: what's
 * picked since stays. Any other, as going back or a link followed: it's
 * what's picked now.
 */
export function arrived(picked: Picked, address: string): Picked {
    const at = picked.sent.indexOf(address)
    return at >= 0 ? { latest: picked.latest, sent: picked.sent.slice(at + 1) } : { latest: address, sent: [] }
}
