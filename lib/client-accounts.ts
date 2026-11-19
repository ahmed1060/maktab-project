import { z } from "zod"
import { seen } from "./seen-text"

/**
 * Client accounts (CLIENT_PORTAL_PLAN.md §5.1, §5.2; PR 322): what's read of
 * a person sent to be added to a client's people, and how they're given
 * back. No database here: the server reads a person with these rules, and
 * the screen that adds one (step 6c) will check with the same ones.
 */

/** How many people a client can have: each one added is an invitation emailed. */
export const MAX_CLIENT_PEOPLE = 20
/** The longest name kept. */
export const CLIENT_PERSON_NAME_MAX = 100
/** The longest an email address can be. */
const EMAIL_MAX = 254

/** An id as Nizmo makes them. Anything else is nobody's, and isn't asked of the database. */
export const NIZMO_ID = /^[\w-]{1,64}$/

/** One of a client's people, as the list has them. Never their password. */
export type ClientPerson = {
    id: string
    name: string
    email: string
    /** Invited until they set a password, active after. */
    state: "invited" | "active"
    invitedAt: string
    lastSignInAt: string | null
}

/** A client's people, with the client they're of and how many it can have. */
export type ClientPeople = {
    client: { id: string; name: string; archived: boolean }
    max: number
    people: ClientPerson[]
}

/** An email as a client account keeps it: trimmed, and in small letters, so capitals make no second account. */
export const accountEmail = (typed: string) => typed.trim().toLowerCase()

// Marks that turn the direction of the words around them, and a space with
// no width: none of them shows, and one left in a name would follow it into
// every list and message it's written in.
const UNSEEN_MARKS = /[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g

/** A name as it's kept: what can't be seen taken out, and its spaces tidied. */
const tidyName = (typed: string) => seen(typed).replace(UNSEEN_MARKS, "").replace(/\s+/g, " ").trim()

// What a person's email is checked with (lib/validations/user.schema.ts).
const anEmail = z.string().email().max(EMAIL_MAX)

export type SentPerson = { person: { clientId: string; name: string; email: string } } | { problem: "client" | "name" | "name_long" | "email" }

/**
 * A person sent to be added: the client they're of, a name and an email.
 * Nothing sent is trusted to be what it should, so each is read, and the
 * first thing wrong is named.
 */
export function sentPerson(body: unknown): SentPerson {
    const sent = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
    if (typeof sent.clientId !== "string" || !NIZMO_ID.test(sent.clientId)) return { problem: "client" }
    const name = typeof sent.name === "string" ? tidyName(sent.name) : ""
    if (!name) return { problem: "name" }
    if (name.length > CLIENT_PERSON_NAME_MAX) return { problem: "name_long" }
    const email = typeof sent.email === "string" ? accountEmail(sent.email) : ""
    if (!anEmail.safeParse(email).success) return { problem: "email" }
    return { person: { clientId: sent.clientId, name, email } }
}
