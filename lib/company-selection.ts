/**
 * The Super Admin's "which company am I looking at" choice, kept in
 * localStorage and read through useSyncExternalStore.
 *
 * It used to be copied into React state by an effect on mount: two copies of
 * one value, with an effect keeping them in step. Read as an external store
 * there is one.
 *
 * Other tabs are followed too, through the storage event. The scope cookie the
 * server reads is shared by every tab already, so a tab still showing the old
 * company was showing something the server no longer agreed with.
 */

const KEY = 'selectedCompanyId'
const ALL = 'ALL'
const listeners = new Set<() => void>()
// Where the choice lives when localStorage cannot be used at all (storage
// disabled): it then lasts until the page is reloaded, as it always did.
let unstored: string | null = null

/** The stored selection; null means All Companies, and so does anything unreadable. */
export function readCompanySelection(): string | null {
    try {
        const stored = localStorage.getItem(KEY)
        return !stored || stored === ALL ? null : stored
    } catch {
        return unstored
    }
}

/** True once a choice has been made in this browser, All Companies included. */
export function hasCompanySelection(): boolean {
    try {
        return localStorage.getItem(KEY) !== null
    } catch {
        return false
    }
}

export function writeCompanySelection(id: string | null): void {
    unstored = id
    try {
        localStorage.setItem(KEY, id || ALL)
    } catch {
        // Storage disabled: `unstored` carries it instead.
    }
    for (const listener of listeners) listener()
}

export function subscribeCompanySelection(onChange: () => void): () => void {
    listeners.add(onChange)
    const onStorage = (e: StorageEvent) => {
        if (e.key === KEY || e.key === null) onChange()
    }
    window.addEventListener('storage', onStorage)
    return () => {
        listeners.delete(onChange)
        window.removeEventListener('storage', onStorage)
    }
}
