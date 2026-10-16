import { fetcher } from './swr-fetcher'

/**
 * A list keeps its rows up while the next page or filter loads
 * (`keepPreviousData`), so the screen doesn't drop to a spinner at every
 * step. Across companies it mustn't: a Super Admin who has just picked
 * another company would still see the last one's rows, and could edit or
 * delete them, until the new rows came, or for good if they didn't.
 *
 * So each response carries the company it's for, and `forScope` drops one
 * for another company, as if nothing had loaded yet:
 *
 *   const { data } = useSWR(scopedKey(url, companyId), scopedFetcher, { keepPreviousData: true })
 *   const result = forScope(data, companyId)
 *
 * No company (one's own, or all of them for a Super Admin who hasn't picked
 * one) is a scope too.
 */
export type Scoped<T = any> = { scope: string; body: T }

export function scopedKey(url: string | null, scope: string | null | undefined): [string, string] | null {
    return url ? [url, scope ?? ''] : null
}

export async function scopedFetcher([url, scope]: [string, string]): Promise<Scoped> {
    return { scope, body: await fetcher(url) }
}

export function forScope<T>(data: Scoped<T> | undefined, scope: string | null | undefined): T | undefined {
    return data && data.scope === (scope ?? '') ? data.body : undefined
}
