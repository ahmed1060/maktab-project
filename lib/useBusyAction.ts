"use client"

import { createContext, useCallback, useContext, useRef, useState } from "react"

/**
 * Told as each action starts, before it sends anything, by every busy
 * action inside it: a list showing what someone else changed takes the
 * next draw as the person's own (components/useArrivals.ts), though their
 * change's live signal comes before the answer (found by Codex on PR 251).
 */
export const ActionStarts = createContext<(() => void) | null>(null)

/**
 * One action at a time on a screen, and the button that started it showing so.
 *
 *   const action = useBusyAction()
 *   <button onClick={() => action.run("approve", approve)}
 *           disabled={action.running} aria-busy={action.is("approve")}>
 *
 * While the work is out every button wired to it is off (no second approve,
 * no reject racing the approve), and the one that was clicked turns a ring —
 * globals.css draws it for aria-busy. A repeat click before React has
 * re-rendered is ignored too, through the ref rather than the state.
 */
export function useBusyAction(onStart?: () => void) {
    const [current, setCurrent] = useState<string | null>(null)
    const inFlight = useRef<string | null>(null)
    // The screen's own says it in onStart, as it's outside its ActionStarts.
    const told = useContext(ActionStarts)
    const start = onStart ?? told

    const run = useCallback(async <T,>(key: string, work: () => Promise<T> | T): Promise<T | undefined> => {
        if (inFlight.current) return undefined
        inFlight.current = key
        start?.()
        setCurrent(key)
        try {
            return await work()
        } finally {
            inFlight.current = null
            setCurrent(null)
        }
    }, [start])

    return {
        run,
        /** Some action is under way. */
        running: current !== null,
        /** For aria-busy: true on the button whose action this is, else undefined. */
        is: (key: string) => (current === key ? true : undefined),
    }
}
