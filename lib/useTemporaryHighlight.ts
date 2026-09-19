import { useEffect, useState } from "react"

/**
 * True while something is highlighted, and false again once it has had its
 * moment — the tinted border and pulse a row gets when you arrive at a page
 * from a notification that points at it.
 *
 * Four components had the same effect:
 *
 *     const [show, setShow] = useState(isHighlighted)
 *     useEffect(() => {
 *         if (isHighlighted) {
 *             setShow(true)
 *             const t = setTimeout(() => setShow(false), 6000)
 *             return () => clearTimeout(t)
 *         } else {
 *             setShow(false)
 *         }
 *     }, [isHighlighted])
 *
 * Both of those setState calls run synchronously inside the effect, so every
 * highlighted row rendered, committed, immediately set state, and rendered
 * again — to arrive at a value the render before it could have worked out on
 * its own.
 *
 * The state that genuinely cannot be derived is small: whether the timer has
 * fired yet. Everything else follows from the prop. So the timer is all the
 * effect does, and the answer is computed rather than stored.
 *
 * The reset is done during render rather than in an effect. That looks unusual
 * and it is the pattern React documents for exactly this — a prop changing
 * should discard state derived from the old one. React re-runs the component
 * immediately without committing the first pass, so nothing is painted twice
 * and no effect has to fire to correct it. Without it, a row highlighted a
 * second time would stay dark, because the timer from the first highlight had
 * already said it was over.
 */
export function useTemporaryHighlight(isHighlighted: boolean | undefined, durationMs = 6000): boolean {
    // Optional in every caller, so undefined and false mean the same thing here.
    const active = Boolean(isHighlighted)

    const [faded, setFaded] = useState(false)
    const [previous, setPrevious] = useState(active)

    if (active !== previous) {
        setPrevious(active)
        setFaded(false)
    }

    useEffect(() => {
        if (!active) return
        const timer = setTimeout(() => setFaded(true), durationMs)
        return () => clearTimeout(timer)
    }, [active, durationMs])

    return active && !faded
}
