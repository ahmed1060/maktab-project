import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { verifyResourceAccess } from "@/lib/security"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { unlockSignIn } from "@/lib/sign-in-lock"
import { unpauseOwnPassword } from "@/lib/own-password"

/**
 * Lifts a sign-in lock before its fifteen minutes are up (lib/sign-in-lock.ts):
 * the lock is the account's, so anyone who knows somebody's email can set it
 * off. Whoever may reset somebody's password may do this, in their own
 * company: a Super Admin anywhere, a company's Admin for their own people
 * (decided 2026-11-03), but never their own. It gives no access, only another
 * try at their own password, so it asks for nothing more, as resetting the
 * password doesn't. It lifts the pause on their password tries too, which
 * five wrong ones set off where one's own password is asked for (PR 229;
 * decided 2026-11-08, for the same people).
 */
export const POST = withStandardHandler(async (req, session, json, { params }) => {
    if (!can(session.user, "employees.reset_password")) return ApiResponse.forbidden()
    const id = params.id
    // Somebody signed in isn't locked out, so their own account is never
    // theirs to unlock; holding an Admin's session, it was a way to start
    // its counts over (Codex on PR 183).
    if (id === session.user.id) return ApiResponse.forbidden("You can't unlock your own sign-in")
    const hasAccess = await verifyResourceAccess(session, id, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    await unlockSignIn(id)
    await unpauseOwnPassword(id)
    const bySuperAdmin = session.user.role === 'SUPER_ADMIN'
    await AuditLogService.log('UNLOCK_SIGN_IN', 'USER', id, {
        userId: bySuperAdmin ? null : session.user.id,
        superAdminId: bySuperAdmin ? session.user.id : null,
    })
    return ApiResponse.success({ id })
})
