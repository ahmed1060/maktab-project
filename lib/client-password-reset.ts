import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { accountEmail } from "@/lib/client-accounts"
import { unlockSignIn } from "@/lib/sign-in-lock"

/**
 * Forgot your password for one of a client's people (CLIENT_PORTAL_PLAN.md
 * §5.3, §12 step 7c; PR 333), on the sign-in page's two reset steps, as for
 * one of the company's people (app/api/auth/forgot-password/). Found by
 * their email as signing in finds them, only where no person or Super Admin
 * has it, as one email is one account across the three (§5.1).
 */

/**
 * The client account Forgot password is for: one whose password is set.
 * Someone invited sets theirs from the invitation's link, which the office
 * can send again (§5.2), so gets no code; they're told what anyone is.
 */
export async function clientAccountToReset(email: string) {
    const account = await prisma.clientAccount.findUnique({
        where: { email: accountEmail(email) },
        select: { id: true, clientId: true, name: true, email: true, activatedAt: true },
    })
    return account?.activatedAt ? account : null
}

type Resettable = NonNullable<Awaited<ReturnType<typeof clientAccountToReset>>>

/**
 * Sets the new password, with the code checked: their open sessions end at
 * the next check (lib/auth.ts, clientSessionStands), and a sign-in lock is
 * lifted, as for a person. False where the account was removed, or isn't
 * active, meanwhile: nothing is set, and nothing written.
 */
export async function resetClientPassword(account: Resettable, newPassword: string): Promise<boolean> {
    // The cost a client account's password is set at (lib/services/client-invitation.service.ts).
    const hashed = await bcrypt.hash(newPassword, 10)
    const { count } = await prisma.clientAccount.updateMany({
        where: { id: account.id, activatedAt: { not: null } },
        data: { password: hashed, sessionVersion: { increment: 1 } },
    })
    if (!count) return false
    await unlockSignIn(account.id)
    const { AuditLogService } = await import("@/lib/services/audit-log.service")
    // Under its client, as their sign-ins are (PR 332): it's no one of the company's people.
    await AuditLogService.log("PASSWORD_RESET", "VENDOR", account.clientId, {
        details: { person: account.name, email: account.email },
    })
    return true
}
