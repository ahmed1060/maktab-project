import type { CSSProperties } from 'react'

/**
 * The tax position page's building blocks (DESIGN.md §3.2, §5.5;
 * CLIENT_PORTAL_PLAN.md §12 step 8b; PR 337): bars by part, the share bar,
 * and a page's one large figure. Pages give them their words and amounts
 * already written in the page's language; the blocks draw them.
 */

/** One part of an amount, as bars by part draws it. */
export type BarPart = {
    key: string
    /** Its name in full: a long one is cut short in the row and shown whole when pointed at. */
    name: string
    /** What its bar is drawn to. */
    value: number
    /** The amount, as the page writes it. */
    amount: string
    /** Under the amount, in muted: such as its share and how many there are. */
    note?: string
}

/**
 * Each bar's length, as a share of the largest, to the hundredth of a
 * percent: the largest is 100, the rest to scale. A part at nothing, or
 * less, has none (null). One too small to show at this scale is 0, and the
 * stylesheet still draws it 4px long, so it's there.
 */
export function barLengths(values: number[]): (number | null)[] {
    const largest = values.reduce((most, v) => Math.max(most, v), 0)
    return values.map(v => (v > 0 && largest > 0 ? Math.round((v / largest) * 10000) / 100 : null))
}

/**
 * How an amount splits into a few named parts, to compare them (DESIGN.md
 * §5.5, Bars by part): a row for each, its name, a bar and its amount, the
 * largest first unless the parts have an order of their own. One colour, as
 * the names say which part is which; the bars are hidden from screen
 * readers, which read each row's name, amount and note.
 */
export function BarsByPart({ label, parts, ordered = false }: {
    /** What the bars show, naming the list for screen readers. */
    label: string
    parts: BarPart[]
    /** The parts have an order of their own, such as how long ago, and keep it. */
    ordered?: boolean
}) {
    // Sorting keeps parts owing the same in the order they came.
    const shown = ordered ? parts : [...parts].sort((a, b) => b.value - a.value)
    const lengths = barLengths(shown.map(p => p.value))
    return (
        <ul className="ui-bars" aria-label={label}>
            {shown.map((p, i) => (
                <li key={p.key} className="ui-bars-row" title={`${p.name}: ${p.amount}`}>
                    {/* The spaces keep a screen reader from running the name, the amount and the note together. */}
                    <span className="ui-bars-name">{p.name}</span>{' '}
                    <span className="ui-bars-track" aria-hidden="true">
                        {lengths[i] !== null && <span className="ui-bars-bar" style={{ ['--part' as string]: `${lengths[i]}%` } as CSSProperties} />}
                    </span>
                    <span className="ui-bars-amount ui-num">{p.amount}</span>
                    {p.note && <>{' '}<span className="ui-bars-note">{p.note}</span></>}
                </li>
            ))}
        </ul>
    )
}

/**
 * How much of a whole is done, such as how much of a client's claims is
 * paid (DESIGN.md §5.5, Share bar): a line saying it in words, the two
 * amounts at its end, over a bar. Screen readers read the line; the bar is
 * hidden from them.
 */
export function ShareBar({ share, line, amounts }: {
    /** How much is done, from 0 to 1. */
    share: number
    /** It in words, such as "16% paid". */
    line: string
    /** The two amounts, such as "210.25 of 1,340.25". */
    amounts?: string
}) {
    const percent = Math.round(Math.min(1, Math.max(0, share)) * 10000) / 100
    return (
        <div className="ui-share">
            <p className="ui-share-line">
                <span>{line}</span>
                {amounts && <>{' '}<span className="ui-share-amounts ui-num">{amounts}</span></>}
            </p>
            <span className="ui-share-track" aria-hidden="true">
                {percent > 0 && <span className="ui-share-bar" style={{ ['--share' as string]: `${percent}%` } as CSSProperties} />}
            </span>
        </div>
    )
}

/**
 * A page's one large figure (DESIGN.md §3.2, §5.5), such as what a client
 * owes: the amount in --text-hero and even-width digits, its unit after it.
 * Its label is the page's, above it.
 */
export function LargeFigure({ value, unit }: {
    /** The amount, as the page writes it. */
    value: string
    /** Such as the currency. */
    unit?: string
}) {
    return (
        <p className="ui-large-figure">
            <span className="ui-large-figure-value ui-num">{value}</span>
            {unit && <>{' '}<span className="ui-large-figure-unit">{unit}</span></>}
        </p>
    )
}
