import { useSyncExternalStore } from "react"

/**
 * False while rendering on the server and during the first client render,
 * true from hydration onwards.
 *
 * Sixteen components had their own copy of this:
 *
 *     const [mounted, setMounted] = useState(false)
 *     useEffect(() => { setMounted(true) }, [])
 *
 * which works, and costs a guaranteed second render every single time one of
 * them mounts. React renders, runs the effect, the effect sets state, React
 * renders again — for a value that was never going to be anything else. On a
 * list of fifty rows each holding a SafeDate, that is fifty wasted passes.
 *
 * useSyncExternalStore was built for exactly this question. The server snapshot
 * is false and the client snapshot is true, so React resolves it as part of
 * hydration rather than as a state update afterwards. Nothing ever changes, so
 * subscribe hands back a no-op unsubscribe and is never called again.
 *
 * Use it for the thing the pattern was always for: gating something that cannot
 * run on the server — a portal, a locale-dependent date, a window measurement.
 * It is not a general "is the component ready" flag.
 */

// Nothing to subscribe to: the value flips once, at hydration, and React
// already knows when that happens.
const subscribe = () => () => {}

export function useHydrated(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => true,   // client
        () => false,  // server, and the first client render that must match it
    )
}
