/**
 * Refusals a service throws as a code, with the answer the person gets.
 *
 * A route answers the codes it knows itself. One that reaches the handler
 * unanswered used to become a 500, "we couldn't complete that action", with
 * an error reference, and was logged as a system fault. For an ordinary
 * refusal (leave on a day already asked for, a twenty-first attachment) that
 * is the wrong answer: the person did nothing wrong that a retry would fix,
 * and wasn't told what to change. withStandardHandler answers these instead.
 *
 * lib/api-errors.test.ts fails on any code a service throws that neither a
 * route nor this map answers, other than the few listed there as faults.
 */
export const KNOWN_REFUSALS: Record<string, { status: 400 | 403 | 404 | 409; message: string }> = {
    DATE_IN_PAST: { status: 400, message: "You can't ask for leave on a day that has passed." },
    OVERLAPPING_REQUEST: { status: 409, message: "You already have a leave request for that day." },
    ATTACHMENT_LIMIT_EXCEEDED: { status: 400, message: "A task or obligation can have at most 20 attachments." },
    COST_LIMIT_EXCEEDED: { status: 400, message: "Costs added at once can total at most 10,000." },
    COMPLETED_REQUEST_STATUS_LOCKED: { status: 400, message: "A completed request can't go back to pending or in progress." },
    INVALID_ITEM_TYPE: { status: 400, message: "Unknown item type." },
    NOTE_NOT_FOUND: { status: 404, message: "Note not found." },
    SETTLEMENT_NOT_FOUND: { status: 404, message: "Settlement not found." },
    ONLY_PAID_SUPPORTED: { status: 400, message: "A payment can only be marked as paid." },
    UNKNOWN_SUBSCRIPTION_TYPE: { status: 400, message: "This payment's subscription type isn't one the system knows." },
    SOME_TASKS_NOT_FOUND_OR_ACCESS_DENIED: { status: 403, message: "Some of these tasks don't exist, or aren't yours to pay." },
}

export function knownRefusal(error: unknown) {
    const code = error instanceof Error ? error.message : undefined
    return code && Object.hasOwn(KNOWN_REFUSALS, code) ? KNOWN_REFUSALS[code] : undefined
}
