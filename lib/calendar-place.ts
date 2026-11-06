/**
 * Where a date field's calendar opens on a computer (DESIGN.md §5.3): under
 * the field, from its start edge, or above it when there's no room below;
 * kept on the screen sideways, and no taller than the room on its side, to
 * scroll inside when it doesn't fit. On a phone the CSS puts it in the
 * middle of the screen instead, and none of this is used.
 *
 * The calendar is fixed to the screen and drawn on the page's body, so a
 * dialog's edge can't cut it off. `start` is counted from the start edge: the
 * left one, or in Arabic the right one, for `inset-inline-start`.
 */

export type Edges = { top: number; bottom: number; left: number; right: number }
export type Size = { width: number; height: number }
export type Place = { start: number; top?: number; bottom?: number; maxHeight: number }

/** Between the field and the calendar. */
const GAP = 4
/** Kept between the calendar and the screen's edges. */
const MARGIN = 8

export function calendarPlace(field: Edges, calendar: Size, view: Size, rtl: boolean): Place {
    const below = view.height - MARGIN - (field.bottom + GAP)
    const above = field.top - GAP - MARGIN
    const fromStart = rtl ? view.width - field.right : field.left
    const start = Math.max(MARGIN, Math.min(fromStart, view.width - MARGIN - calendar.width))
    // Below when it fits there, or fits on neither side and there's more room below.
    if (calendar.height <= below || (calendar.height > above && below >= above)) return { start, top: field.bottom + GAP, maxHeight: below }
    return { start, bottom: view.height - field.top + GAP, maxHeight: above }
}

/**
 * How tall a calendar is with all of it shown. One that scrolls inside is
 * only as tall as the room it was given, which would say it fits where it
 * doesn't. Its edges are in its own height, and not in what scrolls.
 */
export function wholeHeight(panel: { scrollHeight: number; clientHeight: number; offsetHeight: number }): number {
    return panel.scrollHeight + panel.offsetHeight - panel.clientHeight
}
