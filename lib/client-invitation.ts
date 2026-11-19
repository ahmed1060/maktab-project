import { createHash, randomBytes } from "node:crypto"
import { hasModule, resolveBundles, type PackageFacts } from "./features/bundles"
import { summarizeSubscription } from "./billing/summary"
import { PASSWORD_MAX, PASSWORD_MIN } from "./new-employee-form"
import type { ClientLanguage } from "./client-accounts"

/**
 * The invitation's link, which one of a client's people sets their password
 * from (CLIENT_PORTAL_PLAN.md §5.2, step 6b-1; PR 324). No database here: the
 * service reads and saves, and these are the rules both it and the page use.
 */

/** How long a link works. */
export const INVITATION_HOURS = 72
/** Where it opens. */
export const INVITATION_PATH = "/invitation"

// A secret is 32 random bytes, written as 43 characters of base64url.
const SECRET = /^[A-Za-z0-9_-]{43}$/

/** The secret's SHA-256, which is all that's kept of it: nothing in the database opens a link. */
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex")

/** A new link: its secret, the hash that's kept, and when it stops working. */
export function newInvitation(now: Date = new Date()): { token: string; tokenHash: string; expiresAt: Date } {
    const token = randomBytes(32).toString("base64url")
    return { token, tokenHash: hashOf(token), expiresAt: new Date(now.getTime() + INVITATION_HOURS * 3600_000) }
}

/** The hash a sent secret is looked up by, or null for anything Nizmo couldn't have made. */
export function invitationHash(token: unknown): string | null {
    return typeof token === "string" && SECRET.test(token) ? hashOf(token) : null
}

/**
 * The link an invitation's email carries. Its secret is after the #, which a
 * browser never sends to a server, so it's in no request's address, log or
 * referrer: the page reads it, and sends it in a request's body.
 */
export function invitationLink(origin: string, token: string): string {
    return `${origin.replace(/\/+$/, "")}${INVITATION_PATH}#${token}`
}

/** What a link says, read: who invited them, for whom, their email, until when, and the language the page opens in. */
export type InvitationView = { office: string; client: string; email: string; expiresAt: string; language: ClientLanguage }

/** What the page sends to read a link: its secret. */
export function sentInvitation(body: unknown): { token: string } | { problem: "token" } {
    const token = (body && typeof body === "object" ? body : {}) as { token?: unknown }
    return invitationHash(token.token) ? { token: token.token as string } : { problem: "token" }
}

/**
 * What the page sends to set the password: the secret, and the password
 * twice, as Change password asks it. As long as every password in Nizmo is,
 * 12 to 72 characters, and kept as typed: spaces are part of it.
 */
export function sentPassword(body: unknown): { token: string; password: string } | { problem: "token" | "short" | "long" | "mismatch" } {
    const sent = (body && typeof body === "object" ? body : {}) as { token?: unknown; password?: unknown; confirmPassword?: unknown }
    if (!invitationHash(sent.token)) return { problem: "token" }
    const password = typeof sent.password === "string" ? sent.password : ""
    if (password.length < PASSWORD_MIN) return { problem: "short" }
    if (password.length > PASSWORD_MAX) return { problem: "long" }
    if (sent.confirmPassword !== password) return { problem: "mismatch" }
    return { token: sent.token as string, password }
}

/** A company as whether its portal is open is decided from. */
export type PortalCompany = {
    createdAt: Date
    trialPreset: string | null
    trialExtensionDays: number | null
    isBanned: boolean
    package: (PackageFacts & { hasClientPortal?: boolean }) | null
    payments: { endDate: Date | null; graceExtensionHours: number | null }[]
}

/**
 * Whether the office's portal is open to its client's people (§5.3): the
 * client in use, and the company's package with the client portal, its
 * subscription not ended and the company not barred. A company with no
 * package hasn't the portal (§2). The same rules sign-in will hold them to
 * (step 7).
 */
export function portalOpen(client: { archivedAt: Date | null }, company: PortalCompany, now: Date = new Date()): boolean {
    if (client.archivedAt || company.isBanned) return false
    if (!company.package || !hasModule(resolveBundles(company.package), "TAX_POSITION")) return false
    return summarizeSubscription(company, now)?.state !== "LOCKED"
}
