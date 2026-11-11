"use client"

import { createContext, useCallback, useContext, useRef, useState } from "react"

/**
 * Says an action has started, before it sends anything; what it returns
 * says the action was answered, saved or not.
 */
export type ActionStart = () => () => void

/**
 * Told as each action starts, and as it's answered, saved or refused, by
 * every busy action inside it: a list showing what someone else changed
 * takes what's drawn meanwhile as the person's own
 * (components/useArrivals.ts), though their change's live signal comes
 * before the answer (found by Codex on PR 251), or a two-factor code holds
 * it on the way (PR 252). Whether the draw after the answer is theirs too,
 * their page says, as only it knows whether the change was saved.
 */
export const ActionStarts = createContext<ActionStart | null>(null)

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
export function useBusyAction(onStart?: ActionStart) {
    const [current, setCurrent] = useState<string | null>(null)
    const inFlight = useRef<string | null>(null)
    // The screen's own says it in onStart, as it's outside its ActionStarts.
    const told = useContext(ActionStarts)
    const start = onStart ?? told

    const run = useCallback(async <T,>(key: string, work: () => Promise<T> | T): Promise<T | undefined> => {
        if (inFlight.current) return undefined
        inFlight.current = key
        const answered = start?.()
        setCurrent(key)
        try {
            return await work()
        } finally {
            answered?.()
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
