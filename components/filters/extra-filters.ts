import type { ExtraFilter } from '@/components/locations/usePlaceFilters'

/** A filter's options for what's picked in the others, as a location's follow its client's. */
export function optionsOf(filter: ExtraFilter, picked: Record<string, string>) {
    return typeof filter.options === 'function' ? filter.options(picked) : filter.options
}

/**
 * The filters' values once one is picked. Any that follows it and no longer
 * offers its own pick is cleared, as a location of another client. A hidden
 * one offers none: it's kept until Reset.
 */
export function pickExtra(filters: ExtraFilter[], picked: Record<string, string>, key: string, value: string): Record<string, string> {
    const next = { ...picked, [key]: value }
    for (const f of filters) {
        if (!f.hidden && next[f.key] && !optionsOf(f, next).some(o => o.value === next[f.key])) next[f.key] = ''
    }
    return next
}
