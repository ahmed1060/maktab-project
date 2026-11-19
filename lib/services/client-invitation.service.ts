import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { invitationHash, portalOpen, sentInvitation, sentPassword, type InvitationView } from "@/lib/client-invitation"

/**
 * Setting a password from an invitation (CLIENT_PORTAL_PLAN.md §5.2, step
 * 6b-1; PR 324): reading the link, and setting the password from it, once,
 * for 72 hours. Open to anyone who has the link, as a link in an email has to
 * be: nothing here reads a session, and nothing is told apart that would say
 * which emails an office invited.
 */

/** What a link is read with: the account, its client and the client's company, as far as the portal needs. */
const LINKED = {
    id: true, name: true, email: true, inviteExpiresAt: true,
    client: { select: { id: true, name: true, archivedAt: true } },
    company: {
        select: {
            name: true, createdAt: true, trialPreset: true, trialExtensionDays: true, isBanned: true,
            package: { select: { hasCompanyManagement: true, hasHR: true, hasClientPortal: true } },
            // The furthest-reaching confirmed period, as sign-in reads it (lib/auth.ts).
            payments: { where: { status: "PAID" }, orderBy: { endDate: "desc" }, take: 1, select: { endDate: true, graceExtensionHours: true } },
        },
    },
} as const

/**
 * The account a link is for, where it can still be used: refused where Nizmo
 * never made it, it was used or replaced, or the person was removed, which
 * aren't told apart; where it ran out; and where the office's portal isn't
 * open to its client's people (§5.3).
 */
async function linkedAccount(tokenHash: string, now: Date) {
    const account = await prisma.clientAccount.findUnique({ where: { inviteTokenHash: tokenHash }, select: LINKED })
    if (!account || !account.inviteExpiresAt) throw new Error("INVITATION_UNKNOWN")
    if (account.inviteExpiresAt.getTime() <= now.getTime()) throw new Error("INVITATION_EXPIRED")
    if (!portalOpen(account.client, account.company, now)) throw new Error("INVITATION_CLOSED")
    return account
}

/** A link, read: who invited them, for whom, their email, and until when. */
export async function readInvitation(body: unknown, now: Date = new Date()): Promise<InvitationView> {
    const sent = sentInvitation(body)
    if ("problem" in sent) throw new Error("INVITATION_TOKEN_REQUIRED")
    const account = await linkedAccount(invitationHash(sent.token)!, now)
    return { office: account.company.name, client: account.client.name, email: account.email, expiresAt: account.inviteExpiresAt!.toISOString() }
}

const PASSWORD_REFUSALS = { token: "INVITATION_TOKEN_REQUIRED", short: "INVITATION_PASSWORD_SHORT", long: "INVITATION_PASSWORD_LONG", mismatch: "INVITATION_PASSWORD_MISMATCH" } as const

/**
 * Sets the password from a link (§5.2): the account is active, the link stops
 * working, and anything signed in with the account before ends, as a new
 * password ends a person's other sessions. Gives back the email to sign in
 * with.
 *
 * The account is held while it's set, so two at once set it once: the second
 * finds the link gone, and is told it doesn't work. Its client is held first,
 * as archiving and deleting it hold it, so one archived meanwhile is refused,
 * and one deleted meanwhile took the link with it.
 */
export async function setInvitationPassword(body: unknown, now: Date = new Date()): Promise<{ email: string }> {
    const sent = sentPassword(body)
    if ("problem" in sent) throw new Error(PASSWORD_REFUSALS[sent.problem])
    const tokenHash = invitationHash(sent.token)!
    const account = await linkedAccount(tokenHash, now)
    // Hashed before the account is held, as it takes a moment: at the cost
    // the company's people's passwords have (app/api/auth/forgot-password).
    const hashed = await bcrypt.hash(sent.password, 10)

    const { AuditLogService } = await import("./audit-log.service")
    return prisma.$transaction(async tx => {
        // One query after another from here: a transaction has one connection.
        // The client first, then its person, in the order deleting a client
        // holds them (it holds the client, and its people go with it), so
        // neither waits on the other (found by Codex on PR 324). Deleted
        // meanwhile, its people went with it.
        const client = await tx.$queryRaw<{ archivedAt: Date | null }[]>`SELECT "archivedAt" FROM "Client" WHERE id = ${account.client.id} FOR SHARE`
        if (!client.length) throw new Error("INVITATION_UNKNOWN")
        if (client[0].archivedAt) throw new Error("INVITATION_CLOSED")
        // Found by its link: one set meanwhile, or removed, has none now.
        const held = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ClientAccount" WHERE "inviteTokenHash" = ${tokenHash} FOR UPDATE`
        if (!held.length) throw new Error("INVITATION_UNKNOWN")

        await tx.clientAccount.update({
            where: { id: held[0].id },
            data: { password: hashed, activatedAt: now, inviteTokenHash: null, inviteExpiresAt: null, sessionVersion: { increment: 1 } },
        })
        // By none of the company's people: the account isn't one of them.
        await AuditLogService.log("ACCEPT_CLIENT_INVITATION", "VENDOR", account.client.id, {
            tx,
            details: { name: account.client.name, person: account.name, email: account.email, account: account.id },
        })
        return { email: account.email }
    }, { maxWait: 10_000, timeout: 20_000 })
}
