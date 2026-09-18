/**
 * What has to be true before a month can be frozen.
 *
 * Approval is the point of no return in this system. After it the figures stop
 * being a view and become a record, the month closes to correction, and the
 * next step is money leaving. So the conditions are decided here, in one pure
 * function, where they can be read and tested without a database — rather than
 * as a sequence of early returns inside a transaction nobody reads twice.
 */

export interface ApprovalInput {
    status: "DRAFT" | "APPROVED" | "PAID"
    /** People whose month could not be computed at all. */
    refused: { userId: string; name: string; reason: string }[]
    /** People with days under a suspension nobody has ruled on. */
    pendingDecisions: { userId: string; name: string; undecidedDays: number }[]
    /** Whether the approver has explicitly said they know about the above. */
    acknowledgePending: boolean
    /** Nobody to pay is not an error, but it is worth refusing by accident. */
    includedCount: number
}

export type ApprovalRefusal =
    | { code: "ALREADY_APPROVED"; message: string }
    | { code: "CANNOT_COMPUTE"; message: string; names: string[] }
    | { code: "PENDING_UNACKNOWLEDGED"; message: string; names: string[] }
    | { code: "NOBODY_TO_PAY"; message: string }

export type ApprovalVerdict =
    | { ok: true }
    | { ok: false; refusal: ApprovalRefusal }

export function checkApproval(input: ApprovalInput): ApprovalVerdict {
    if (input.status !== "DRAFT") {
        return {
            ok: false,
            refusal: {
                code: "ALREADY_APPROVED",
                message: "This month has already been approved. Approving again would restate figures that have been issued.",
            },
        }
    }

    // A hard refusal, not something to acknowledge. Somebody whose month cannot
    // be computed is not on the register at all, so approving would pay
    // everybody else and leave them with no payslip and no record of why — a
    // failure that arrives as an absence, which is the kind nobody notices. It
    // is also cheap to fix: give them a salary history and run it again.
    if (input.refused.length > 0) {
        const names = input.refused.map(r => r.name)
        return {
            ok: false,
            refusal: {
                code: "CANNOT_COMPUTE",
                message:
                    `${names.length} ${names.length === 1 ? "person" : "people"} cannot be calculated, so they are not on this register at all. ` +
                    `Approving now would pay everybody else and leave them with nothing and no record of why.`,
                names,
            },
        }
    }

    // Acknowledged rather than refused, because the answer is "pay them for now
    // and decide later" and that is a legitimate choice. What is not legitimate
    // is making it without noticing, so it takes a deliberate act.
    if (input.pendingDecisions.length > 0 && !input.acknowledgePending) {
        const names = input.pendingDecisions.map(p => p.name)
        return {
            ok: false,
            refusal: {
                code: "PENDING_UNACKNOWLEDGED",
                message:
                    `${names.length} ${names.length === 1 ? "person has" : "people have"} days under a suspension nobody has ruled on. ` +
                    `They are being paid for those days. Confirm that you know before approving.`,
                names,
            },
        }
    }

    if (input.includedCount === 0) {
        return {
            ok: false,
            refusal: {
                code: "NOBODY_TO_PAY",
                message: "There is nobody to pay this month, so there is nothing to approve.",
            },
        }
    }

    return { ok: true }
}

/**
 * Whether an adjustment can still be undone.
 *
 * P6 gave rollback and reversal a period to act on; this is what stops them
 * acting on one that has been paid. Undoing an adjustment decrements the salary
 * record it landed on, and a frozen payslip does not move with it — so the
 * document somebody was issued and the figures behind it would disagree, with
 * nothing to say which is right.
 *
 * A correction to a closed month is a new adjustment in an open one, which is
 * what a reversal is for.
 */
export function canUndoAdjustment(runStatus: "DRAFT" | "APPROVED" | "PAID" | null): boolean {
    return runStatus === null || runStatus === "DRAFT"
}
