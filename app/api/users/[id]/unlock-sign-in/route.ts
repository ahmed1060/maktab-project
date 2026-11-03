import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { verifyResourceAccess } from "@/lib/security"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { unlockSignIn } from "@/lib/sign-in-lock"

/**
 * Lifts a sign-in lock before its fifteen minutes are up (lib/sign-in-lock.ts):
 * the lock is the account's, so anyone who knows somebody's email can set it
 * off. Whoever may reset somebody's password may do this, in their own
 * company: a Super Admin anywhere, a company's Admin for their own people
 * (decided 2026-11-03). It gives no access, only another try at their own
 * password, so it asks for nothing more.
 */
export const POST = withStandardHandler(async (req, session, json, { params }) => {
    if (!can(session.user, "employees.reset_password")) return ApiResponse.forbidden()
    const id = params.id
    const hasAccess = await verifyResourceAccess(session, id, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    await unlockSignIn(id)
    const bySuperAdmin = session.user.role === 'SUPER_ADMIN'
    await AuditLogService.log('UNLOCK_SIGN_IN', 'USER', id, {
        userId: bySuperAdmin ? null : session.user.id,
        superAdminId: bySuperAdmin ? session.user.id : null,
    })
    return ApiResponse.success({ id })
})
