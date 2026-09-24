import { useEffect, useState } from "react"

/**
 * The id named by `?highlight=` — for a while, then null.
 *
 * Five screens each did this with an effect that copied the URL value into
 * state and a timer that cleared it. Copying a prop into state inside an effect
 * means a render with the stale value, then a second render with the new one;
 * it is the pattern the React Compiler's set-state-in-effect rule exists to
 * catch. This does the same job the way useTemporaryHighlight already does
 * for single cards: when the id changes, adjust state during render, so the
 * very first render already agrees with the URL, and let the effect own only
 * the timer — whose setState runs later, from a timeout, not synchronously.
 *
 * The duration is the caller's. Three screens faded at 6s. The two request
 * views held it for 10s, because their cards scroll themselves into view when
 * highlighted, and clearing the page's id is what stops a card that remounts
 * later — after paging away and back — from scrolling and pulsing again.
 */
export function useFadingHighlight(id: string | null, durationMs: number): string | null {
    const [expired, setExpired] = useState(false)
    const [previous, setPrevious] = useState(id)
    if (id !== previous) {
        setPrevious(id)
        setExpired(false)
    }

    useEffect(() => {
        if (!id) return
        const timer = setTimeout(() => setExpired(true), durationMs)
        return () => clearTimeout(timer)
    }, [id, durationMs])

    return id && !expired ? id : null
}
