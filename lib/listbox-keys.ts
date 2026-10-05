/**
 * Moving through a list of options with the keyboard (WAI-ARIA listbox
 * pattern): the arrows one option, Home and End to the first and last. The
 * arrows stop at the ends rather than wrapping, as the pattern suggests.
 *
 * Returns the option a key moves to from `current`, or null if the key
 * doesn't move.
 */
export function moveOption(current: number, key: string, count: number): number | null {
    if (count <= 0) return null
    switch (key) {
        case "ArrowDown": return Math.min(current + 1, count - 1)
        case "ArrowUp": return Math.max(current - 1, 0)
        case "Home": return 0
        case "End": return count - 1
        default: return null
    }
}
