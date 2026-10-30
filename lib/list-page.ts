/**
 * The page a list's address asks for: a page that's no page at all, as "0"
 * or "x", is the first.
 */
export function askedPage(raw: string | undefined): { asked: number; page: number } {
    const asked = parseInt(raw || '1')
    return { asked, page: asked >= 1 ? asked : 1 }
}

/**
 * Where a list goes when its address asks for a page that isn't there: past
 * the last, as when its last item goes elsewhere and the page is refreshed,
 * it's the last there is now, with the same filters; no page at all, the
 * first. Null for a page that's there. An empty list shows its empty state
 * without the pager, so there'd be no way back (found by Codex on PR 117).
 */
export function pageRedirect(path: string, searchParams: Record<string, unknown>, asked: number, pageCount: number): string | null {
    const page = asked >= 1 ? asked : 1
    const last = Math.max(pageCount, 1)
    if (page <= last && page === asked) return null
    const params = new URLSearchParams(Object.entries(searchParams).filter((e): e is [string, string] => typeof e[1] === 'string'))
    params.set('page', String(Math.min(page, last)))
    return `${path}?${params}`
}
