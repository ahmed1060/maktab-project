/**
 * Which leave years a reset still owes a snapshot for.
 *
 * Pure, and separate from the job, because the job runs once a year — on the
 * 1st of January, at one o'clock — and has never run in production. A rule that
 * gets one chance a year to be observed is a rule that has to be correct by
 * construction rather than by having been watched.
 *
 * The bug this exists to remove: the reset assumed exactly one year had passed.
 * It wrote a single snapshot labelled with the year of the last reset and then
 * jumped `lastDayOffResetYear` straight to the current year. Miss one January —
 * a failed run, a deploy, a paused project — and the year in between gets no
 * row at all. DayOffCreditSnapshot is unique on [userId, year], so that gap can
 * never be filled afterwards either: one missed run silently erases a year of
 * leave history, permanently.
 */

/**
 * Beyond this, the span is not a missed run, it is a corrupt year.
 *
 * lastDayOffResetYear is a required column with no default, set from the
 * account's creation year — so a zero or a 1970 in there means something went
 * wrong upstream, and writing two thousand snapshot rows for one person would
 * turn that into a much larger mess than it started as.
 */
export const MAX_RECONSTRUCTED_YEARS = 25

export interface SnapshotYear {
    year: number
    /**
     * True when nobody measured this year's closing balance.
     *
     * Only the first missed year has a real one: the balance sitting on the
     * account today descends from the allowance granted in that year, and kept
     * running down through every year since because no reset came along to
     * re-grant it. The later years are inferences, and they are marked.
     */
    reconstructed: boolean
}

export type ResetPlan =
    | { kind: "UP_TO_DATE" }
    /** The span is implausible. Better to surface it than to act on it. */
    | { kind: "REFUSED"; span: number }
    | { kind: "RESET"; years: SnapshotYear[] }

export function planReset(lastResetYear: number, currentYear: number): ResetPlan {
    if (!Number.isInteger(lastResetYear) || !Number.isInteger(currentYear)) {
        return { kind: "REFUSED", span: NaN }
    }
    if (lastResetYear >= currentYear) return { kind: "UP_TO_DATE" }

    const span = currentYear - lastResetYear
    if (span > MAX_RECONSTRUCTED_YEARS) return { kind: "REFUSED", span }

    const years: SnapshotYear[] = []
    for (let year = lastResetYear; year < currentYear; year++) {
        years.push({ year, reconstructed: year !== lastResetYear })
    }
    return { kind: "RESET", years }
}

/** What a reconstructed snapshot says about itself, in the row itself. */
export const RECONSTRUCTED_NOTE =
    "Reconstructed: the annual reset did not run for this year, so this is the balance carried through it rather than one measured at the time."
