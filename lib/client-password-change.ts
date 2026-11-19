import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/new-employee-form"
import { ownPasswordMatches } from "@/lib/own-password"
import { keepAfterChange } from "@/lib/session-kept"

/**
 * Change password for one of a client's people (CLIENT_PORTAL_PLAN.md §5.3,
 * §12 step 7d-2; PR 335), from the client's area, as one of the company's
 * people changes their own (UserService.update, PR 228 and PR 229): the
 * current password checked by the server, its wrong tries counted with the
 * five in fifteen minutes a person's own password has (lib/own-password.ts);
 * the new one ending the account's other sessions at their next check
 * (lib/client-sign-in.ts), and keeping the one it was changed from.
 */

/** What the route answers for too many wrong tries: no one at the office can lift them for a client's person. */
export const CLIENT_PASSWORD_TRIES = "Too many wrong tries for this account. You can try again within 15 minutes."

/**
 * What the page sends: the current password, and the new one twice, as
 * Change password asks it. As long as every password in Nizmo is, 12 to 72
 * characters, and kept as typed: spaces are part of it.
 */
export function sentPasswordChange(body: unknown): { current: string; password: string } | { problem: "current" | "short" | "long" | "mismatch" } {
    const sent = (body && typeof body === "object" ? body : {}) as { currentPassword?: unknown; newPassword?: unknown; confirmPassword?: unknown }
    // As long as a person's may be sent (lib/validations/user.schema.ts).
    if (typeof sent.currentPassword !== "string" || !sent.currentPassword || sent.currentPassword.length > 256) return { problem: "current" }
    const password = typeof sent.newPassword === "string" ? sent.newPassword : ""
    if (password.length < PASSWORD_MIN) return { problem: "short" }
    if (password.length > PASSWORD_MAX) return { problem: "long" }
    if (sent.confirmPassword !== password) return { problem: "mismatch" }
    return { current: sent.currentPassword, password }
}

const SENT_REFUSALS = { current: "CURRENT_PASSWORD_MISSING", short: "NEW_PASSWORD_SHORT", long: "NEW_PASSWORD_LONG", mismatch: "NEW_PASSWORD_MISMATCH" } as const

/**
 * Sets the account's new password, with its current one right. `from` is the
 * session asking, as its cookie names it, which is kept if it's still good;
 * none is kept without it. Throws CURRENT_PASSWORD_WRONG for a wrong one, and
 * OWN_PASSWORD_TRIES once its wrong tries are used up; CLIENT_ACCOUNT_GONE
 * where the account was removed, or has no password to change.
 */
export async function changeClientPassword(accountId: string, from: { sid?: unknown; sessionVersion?: unknown } | null, body: unknown): Promise<void> {
    const sent = sentPasswordChange(body)
    if ("problem" in sent) throw new Error(SENT_REFUSALS[sent.problem])
    const account = await prisma.clientAccount.findUnique({
        where: { id: accountId },
        select: { password: true, clientId: true, name: true, email: true, client: { select: { name: true } } },
    })
    if (!account?.password) throw new Error("CLIENT_ACCOUNT_GONE")
    if (!(await ownPasswordMatches(accountId, account.password, sent.current))) throw new Error("CURRENT_PASSWORD_WRONG")
    // Hashed before the account is held, as it takes a moment: at the cost
    // its password is set at (lib/services/client-invitation.service.ts).
    const hashed = await bcrypt.hash(sent.password, 10)

    const { AuditLogService } = await import("@/lib/services/audit-log.service")
    await prisma.$transaction(async tx => {
        // One query after another from here: a transaction has one connection.
        // The client first, then its person, in the order deleting a client
        // holds them. Deleted meanwhile, its people went with it.
        await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${account.clientId} FOR SHARE`
        type Row = { password: string | null; sessionVersion: number; keptSession: string | null }
        const [held] = await tx.$queryRaw<Row[]>`SELECT password, "sessionVersion", "keptSession" FROM "ClientAccount" WHERE id = ${accountId} FOR UPDATE`
        if (!held?.password) throw new Error("CLIENT_ACCOUNT_GONE")
        // Changed since it was checked, by a change sent at the same time or a
        // reset: the password checked isn't the current one now.
        if (held.password !== account.password) throw new Error("CURRENT_PASSWORD_WRONG")
        // The session it's set from, worked out from the account as this
        // write moves it on, as a person's is (UserService, keepAsWritten).
        const kept = keepAfterChange(held, from)
        await tx.clientAccount.update({
            where: { id: accountId },
            data: { password: hashed, sessionVersion: { increment: 1 }, keptSession: kept },
        })
        // Under its client, as their sign-ins are (PR 332): it's no one of the company's people.
        await AuditLogService.log("CLIENT_PASSWORD_CHANGE", "VENDOR", account.clientId, {
            tx,
            details: { name: account.client.name, person: account.name, email: account.email, account: accountId },
        })
    }, { maxWait: 10_000, timeout: 20_000 })
}
