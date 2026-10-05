"use client"

import { useCallback, useRef, useState } from "react"

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
export function useBusyAction() {
    const [current, setCurrent] = useState<string | null>(null)
    const inFlight = useRef<string | null>(null)

    const run = useCallback(async <T,>(key: string, work: () => Promise<T> | T): Promise<T | undefined> => {
        if (inFlight.current) return undefined
        inFlight.current = key
        setCurrent(key)
        try {
            return await work()
        } finally {
            inFlight.current = null
            setCurrent(null)
        }
    }, [])

    return {
        run,
        /** Some action is under way. */
        running: current !== null,
        /** For aria-busy: true on the button whose action this is, else undefined. */
        is: (key: string) => (current === key ? true : undefined),
    }
}
