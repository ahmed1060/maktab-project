/**
 * When a click starts a move to another page of this app — the cue for the
 * progress bar at the top (components/NavigationProgress.tsx). Kept apart from
 * the component so the rules can be tested without a browser.
 */

export type ClickLike = {
    button: number
    metaKey: boolean
    ctrlKey: boolean
    shiftKey: boolean
    altKey: boolean
    defaultPrevented: boolean
}

export type AnchorLike = {
    href: string
    target: string
    hasAttribute: (name: string) => boolean
}

/** A plain left click on a link to another page of this site, opened here. */
export function startsNavigation(event: ClickLike, anchor: AnchorLike, here: string): boolean {
    if (event.defaultPrevented || event.button !== 0) return false
    // A new tab or window: this page isn't going anywhere.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
    if (anchor.target && anchor.target !== "_self") return false
    if (anchor.hasAttribute("download")) return false
    let to: URL, from: URL
    try {
        to = new URL(anchor.href, here)
        from = new URL(here)
    } catch {
        return false
    }
    if (to.origin !== from.origin) return false
    // The same page, or only another place on it: nothing will load.
    return to.pathname !== from.pathname || to.search !== from.search
}

export type PlaceLike = { pathname: string; search: string }

/**
 * Whether a step back or forward through history goes to another page of the
 * app, rather than only to another place on this one (a #fragment, as the
 * skip link leaves): only then does a page load, and the bar finish. Started
 * for a fragment, it ran until it gave up (review on #45).
 */
export function historyLeavesPage(shown: PlaceLike, now: PlaceLike): boolean {
    return shown.pathname !== now.pathname || new URLSearchParams(shown.search).toString() !== new URLSearchParams(now.search).toString()
}
