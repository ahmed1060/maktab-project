import { useState } from "react"

/**
 * Run `adjust` in the same render that a value changes, instead of an effect
 * later.
 *
 * The pattern React documents for "reset some state when a prop changes"
 * (react.dev: "Adjusting some state when a prop changes"). The effect version
 * — useEffect(() => setX(...), [prop]) — commits a render with the old state
 * first and only then corrects it, and anything else that runs in between sees
 * the mismatch. Here the component re-renders immediately, before anything is
 * committed, so nothing ever sees the stale combination.
 *
 * That mismatch is not theoretical in this codebase. Three list screens reset
 * to page 1 in an effect when a filter changed, so changing a filter on page 3
 * first fetched page 3 of the new results and then page 1 — two requests, and
 * if the first answered last, a list and a pager that disagreed.
 *
 * Deliberately does nothing on the first render: every caller's state is
 * already initialised from the same value, which is the equivalent of the
 * effect's first run.
 */
export function useAdjustOnChange(deps: readonly unknown[], adjust: () => void): void {
    const [previous, setPrevious] = useState(deps)
    if (deps.length !== previous.length || deps.some((d, i) => !Object.is(d, previous[i]))) {
        setPrevious(deps)
        adjust()
    }
}
