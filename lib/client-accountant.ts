/**
 * A client's responsible accountant (CLIENT_PORTAL_PLAN.md §7, §12 step 9b;
 * PR 343): one of its company's people, whom the client's people write to
 * on WhatsApp. Read the same way on the client's page for the company's
 * people, and with step 9c on the client's own page.
 */

/** Who the client's people can write to, or why they can't write to anyone. */
export type AccountantReach =
    /** The accountant, with a WhatsApp number, whose contract hasn't ended. */
    | "whatsapp"
    /** No one is picked. */
    | "none"
    /** Their profile has no WhatsApp number. */
    | "no_number"
    /** Their contract has ended: they stay picked until another is. */
    | "ended"

export type ClientAccountant = {
    /** The one picked, or null where no one is. */
    person: { id: string; name: string; role: string; whatsappNumber: string | null; ended: boolean } | null
    reach: AccountantReach
}

/** One of the company's people who may be picked. */
export type AccountantCandidate = { id: string; name: string }

/**
 * A contract has ended once the person is archived (their contract's end)
 * or deleted. A suspended person is still employed, and can still be
 * written to.
 */
export const ENDED_STATUSES = ["ARCHIVED", "DELETED"] as const

export function contractEnded(status: string): boolean {
    return (ENDED_STATUSES as readonly string[]).includes(status)
}

/**
 * Whether the client's people can write to their accountant, or why not. An
 * ended contract is said before a missing number: adding one wouldn't help.
 */
export function accountantReach(person: { whatsappNumber: string | null; ended: boolean } | null): AccountantReach {
    if (!person) return "none"
    if (person.ended) return "ended"
    return person.whatsappNumber ? "whatsapp" : "no_number"
}
