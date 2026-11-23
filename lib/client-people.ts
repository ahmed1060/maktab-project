import type { ClientPerson } from "./client-accounts"
import type { TranslationKey } from "./translations"

/**
 * What People who can sign in shows of each of a client's people
 * (CLIENT_PORTAL_PLAN.md §5.2, step 6c-1, PR 326; DESIGN.md §5.5, People who
 * can sign in): the rules the section's rows follow, kept apart from it so
 * they're tested on their own.
 */

/** What a row says at its end: invited and since when, when they last signed in, or that they haven't yet. */
export type PersonStatus = { kind: "invited"; since: string } | { kind: "last"; at: string } | { kind: "never" }

export function personStatus(person: Pick<ClientPerson, "state" | "invitedAt" | "lastSignInAt">): PersonStatus {
    if (person.state === "invited") return { kind: "invited", since: person.invitedAt }
    return person.lastSignInAt ? { kind: "last", at: person.lastSignInAt } : { kind: "never" }
}

/**
 * What a row's menu offers: Resend invitation only to someone still invited,
 * as one active signs in, and with inviting; Remove with removing (PR 381).
 */
export function personActions(person: Pick<ClientPerson, "state">, may: { invite: boolean; remove: boolean }): ("resend" | "remove")[] {
    const actions: ("resend" | "remove")[] = []
    if (may.invite && person.state === "invited") actions.push("resend")
    if (may.remove) actions.push("remove")
    return actions
}

/** Where a client's people are read from. */
export const clientPeopleUrl = (clientId: string) => `/api/client-accounts?clientId=${encodeURIComponent(clientId)}`

/** A change made from the section: adding a person, sending their invitation again, or removing them. */
export type PersonChange = "add" | "resend" | "remove"

/** What a refusal says: under Name or Email where it's that field's, and how long to wait where it's held back. */
export type PersonRefusal = { field?: "name" | "email"; key: TranslationKey; wait?: number }

const REFUSED: Record<string, PersonRefusal> = {
    CLIENT_PERSON_NAME_REQUIRED: { field: "name", key: "client_person_name_required" },
    CLIENT_PERSON_NAME_TOO_LONG: { field: "name", key: "client_person_name_too_long" },
    CLIENT_PERSON_EMAIL_INVALID: { field: "email", key: "client_person_email_invalid" },
    CLIENT_PERSON_EMAIL_IN_USE: { field: "email", key: "client_person_email_in_use" },
    CLIENT_PEOPLE_FULL: { key: "client_people_full" },
    // Archived meanwhile: its people can't be invited (§5.3).
    CLIENT_ARCHIVED: { key: "client_people_archived" },
    CLIENT_NOT_FOUND: { key: "client_people_client_gone" },
    // Removed meanwhile, by somebody else.
    CLIENT_PERSON_NOT_FOUND: { key: "client_person_gone" },
    // Their password was set meanwhile.
    CLIENT_PERSON_ACTIVE: { key: "client_person_active" },
    CLIENT_INVITATION_JUST_SENT: { key: "client_invitation_just_sent" },
}

/** When the server failed: what didn't happen, as nothing was kept of the change (lib/services/client-account.service.ts). */
const FAILED: Record<PersonChange, TranslationKey> = {
    add: "client_person_not_sent",
    resend: "client_people_resend_not_sent",
    remove: "client_people_remove_failed",
}

/**
 * What a refused change says, in the page's language: the server's words
 * are English (lib/api-errors.ts). 'quiet' for the code prompt of a
 * high-risk action, turned down: the prompt said what it needed. Null for
 * one with no code known here, said as the server put it.
 */
export function personRefusal(status: number, body: { code?: unknown; wait?: unknown; error?: unknown } | null | undefined, change: PersonChange): PersonRefusal | "quiet" | null {
    const code = body?.code
    if (code === "STEP_UP_REQUIRED" || code === "MFA_ENROL_REQUIRED") return "quiet"
    if (code === "TOO_MANY_TRIES") return typeof body?.wait === "number" && body.wait > 0 ? { key: "client_people_resend_wait", wait: body.wait } : null
    if (typeof code === "string" && Object.hasOwn(REFUSED, code)) return REFUSED[code]
    return status >= 500 ? { key: FAILED[change] } : null
}
