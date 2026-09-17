/**
 * Deleting the payroll data, and everything that has to be true first.
 *
 * The database holds test data — figures typed to exercise features, not to be
 * paid to anybody — and none of it should survive into a real payroll. So it
 * gets cleared once, before the payroll tables arrive. That is an irreversible
 * mass delete against a live database, which is the single most dangerous
 * operation in this plan, and it is the reason the backup work came first.
 *
 * The decision logic lives here, pure, for the same reason the payroll
 * arithmetic does: it can be tested without a database, and a preflight that
 * can only be exercised by running the dangerous thing is a preflight nobody
 * ever exercises.
 */

/** A table the clear touches, and what happens to it. */
export interface ClearTarget {
    table: string
    /** Why it goes, in the words somebody reviewing the deletion would want. */
    because: string
}

/** A table the clear deliberately leaves alone, and why. */
export interface KeptTarget {
    table: string
    because: string
}

/**
 * Deleted, newest-dependency first.
 *
 * Both are figures, not history: a SalaryRecord is one month's running total
 * and a SalaryAdjustment is a line inside it. Recomputing them from scratch is
 * what the payroll run does anyway.
 */
export const CLEARED: ClearTarget[] = [
    {
        table: "SalaryAdjustment",
        because: "Bonuses and deductions in days, entered to try the feature out. Every one of them is a line on a payslip nobody should ever be issued.",
    },
    {
        table: "SalaryRecord",
        because: "One row per person per month, holding totals derived entirely from the adjustments above. Keeping them after the adjustments go would leave totals nothing adds up to.",
    },
]

/**
 * Kept, and each for a reason that is easy to get wrong.
 *
 * The temptation is to clear everything with 'salary' in the name. Two of these
 * are the effective-dated histories the whole calculation reads from, and
 * deleting them does not reset payroll — it makes every month refuse to compute,
 * including months that have already been paid.
 */
export const KEPT: KeptTarget[] = [
    {
        table: "SalaryChange",
        because: "What each person's salary has been, and since when. Clearing it leaves ratesForMonth with nothing in force, so every payslip — past or future — refuses to compute rather than computing wrongly.",
    },
    {
        table: "EmploymentEvent",
        because: "Whether somebody was employed, and whether they were working. Without the HIRED row every month reads as 'not employed', which values a worked month at zero.",
    },
    {
        table: "DayOffRequest / DayOffCreditSnapshot",
        because: "Leave, not payroll. The salary-deduction requests will point at adjustments that no longer exist; the lookup returns nothing and does nothing, which is the right behaviour for a request whose deduction has been wiped.",
    },
    {
        table: "AuditLog",
        because: "The record of who did what. A clear that erased its own trail would remove the evidence that it happened.",
    },
]

export interface ClearCheck {
    name: string
    passed: boolean
    /** What was found. */
    detail: string
    /** What the operator does about it, when it did not pass. */
    remedy?: string
}

export interface ClearDecision {
    proceed: boolean
    blocking: ClearCheck[]
}

/**
 * Every check has to pass. There is no override flag, on purpose.
 *
 * An escape hatch on a gate like this is used exactly once, in the moment
 * somebody is in a hurry, which is the moment the gate exists for.
 */
export function decideClear(checks: ClearCheck[]): ClearDecision {
    if (checks.length === 0) {
        // An empty list is a preflight that did not run, not one that passed.
        return { proceed: false, blocking: [] }
    }
    const blocking = checks.filter(c => !c.passed)
    return { proceed: blocking.length === 0, blocking }
}

/**
 * The host of a connection string, with the credentials left behind.
 *
 * Used to make the confirmation phrase name the database it will act on, so a
 * phrase copied out of a runbook cannot be pasted at a different one. Parsed
 * rather than printed whole, because this string ends up in a terminal, a shell
 * history and possibly a screenshot.
 */
export function hostOf(databaseUrl: string | undefined): string | null {
    if (!databaseUrl) return null
    try {
        const url = new URL(databaseUrl)
        return url.hostname || null
    } catch {
        return null
    }
}

/** The exact phrase the operator has to type, naming the target. */
export function confirmationPhraseFor(host: string): string {
    return `DELETE PAYROLL DATA FROM ${host}`
}

/**
 * How a drill restore identifies itself in the workflow run list.
 *
 * restore.yml's run-name carries the target, so a successful drill is visible
 * through the Actions API without trusting anything the operator types. The
 * gate is "a restore has actually been proved against a scratch database", and
 * the only thing that can satisfy it is having actually done one.
 */
export const DRILL_RUN_MARKER = "[drill]"

export function looksLikeProvedDrill(run: { conclusion?: string | null; display_title?: string | null; name?: string | null }): boolean {
    if (run.conclusion !== "success") return false
    const title = `${run.display_title ?? ""} ${run.name ?? ""}`.toLowerCase()
    return title.includes(DRILL_RUN_MARKER)
}
