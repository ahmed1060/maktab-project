/**
 * The corner a pop-up grows from as it opens (DESIGN.md §8): the one nearest
 * the button that opened it, so it seems to come out of it. A pop-up lines up
 * with one edge of its button, the start edge or the end edge, and opens
 * under it or, when there's no room there, above it. In Arabic the start
 * edge is the right one.
 *
 * As a CSS transform-origin: there's no logical one, so it's said in left
 * and right.
 */
export function growsFrom(edge: 'start' | 'end', below: boolean, rtl: boolean): string {
    const onTheLeft = (edge === 'start') !== rtl
    return `${below ? 'top' : 'bottom'} ${onTheLeft ? 'left' : 'right'}`
}
