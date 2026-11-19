import type { JWT } from "next-auth/jwt"
import { prisma } from "@/lib/prisma"
import { CLIENT_ACCOUNT_ROLE } from "@/lib/client-session"
import { portalOpen, type PortalCompany } from "@/lib/client-invitation"

/**
 * Signing in as one of a client's people (CLIENT_PORTAL_PLAN.md §5.3, §12
 * step 7b; PR 332): what's read of their account, what their session holds,
 * and the minute's check that ends it. lib/auth.ts finds the account and
 * checks its password as it does a person's.
 *
 * Where the office's portal isn't open to its client's people, the same rule
 * the invitation's page holds them to decides (portalOpen, PR 324).
 */

/** What authorize() throws where the office's portal isn't open, once the password is right (lib/login-errors.ts says it). */
export const CLIENT_PORTAL_CLOSED = "CLIENT_PORTAL_CLOSED"

/** A client account as its session is checked: who it is, its client and its company, as far as the portal needs. */
export const CLIENT_SESSION = {
    id: true, name: true, email: true, language: true, sessionVersion: true, companyId: true, clientId: true,
    client: { select: { id: true, name: true, archivedAt: true } },
    company: {
        select: {
            name: true, createdAt: true, trialPreset: true, trialExtensionDays: true, isBanned: true,
            package: { select: { hasCompanyManagement: true, hasHR: true, hasClientPortal: true } },
            // The furthest-reaching confirmed period, as a person's sign-in reads it.
            payments: { where: { status: "PAID" }, orderBy: { endDate: "desc" }, take: 1, select: { endDate: true, graceExtensionHours: true } },
        },
    },
} as const

/** The same at sign-in, with the password to check. Never read after. */
export const CLIENT_SIGN_IN = { ...CLIENT_SESSION, password: true } as const

type ClientAccountRead = {
    id: string
    name: string
    email: string
    language: string
    sessionVersion: number
    companyId: string
    clientId: string
    client: { id: string; name: string; archivedAt: Date | null }
    company: PortalCompany & { name: string }
}

/** Whether the office's portal is open to this account's client (§5.3). */
export const clientPortalOpen = (account: ClientAccountRead, now: Date = new Date()) => portalOpen(account.client, account.company, now)

/** The language a client account is in: Arabic or English, which the database holds it to. */
const languageOf = (kept: string) => (kept === "en" ? "en" : "ar")

/**
 * Who authorize() gives next-auth for one of a client's people signed in: a
 * client account, for its client and company. Nothing of a person's: no
 * role's grants, package or two-factor.
 */
export function clientAccountUser(account: ClientAccountRead, remember: boolean) {
    return {
        id: account.id,
        role: CLIENT_ACCOUNT_ROLE,
        name: account.name,
        email: account.email,
        clientId: account.clientId,
        clientName: account.client.name,
        companyId: account.companyId,
        companyName: account.company.name,
        language: languageOf(account.language),
        sessionVersion: account.sessionVersion,
        remember,
    }
}

type ClientUser = ReturnType<typeof clientAccountUser>

/** A client account's token, at sign-in: what its session says, and when it was last checked. */
export function clientToken(user: ClientUser): Partial<JWT> {
    return {
        role: CLIENT_ACCOUNT_ROLE,
        clientId: user.clientId,
        clientName: user.clientName,
        companyId: user.companyId,
        companyName: user.companyName,
        language: user.language,
        sessionVersion: user.sessionVersion,
        checkedAt: Date.now(),
    }
}

/**
 * The minute's check of a client account's session: whether it stands. It
 * doesn't where the account is removed, the office's portal has closed to
 * its client, or its sessions were ended since. Where it stands, its
 * client's and company's names are caught up. A check that can't be made
 * throws, and the caller ends the session, as a person's is.
 */
export async function clientSessionStands(token: JWT, now: Date = new Date()): Promise<boolean> {
    const account = await prisma.clientAccount.findUnique({ where: { id: token.sub as string }, select: CLIENT_SESSION }) as ClientAccountRead | null
    if (!account) return false
    if (!clientPortalOpen(account, now)) return false
    if (account.sessionVersion > Number(token.sessionVersion ?? 0)) return false
    token.clientName = account.client.name
    token.companyName = account.company.name
    token.checkedAt = now.getTime()
    return true
}
