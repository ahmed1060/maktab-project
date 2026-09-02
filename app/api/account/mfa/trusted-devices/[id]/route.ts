import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"

// F-27, Phase 6: revoking here only ever marks revokedAt — the row and
// its (hashed) token stay around for the audit trail, same reasoning
// AuditLog rows are never deleted. A revoked device's cookie, if it's
// still sitting in that browser, becomes inert immediately: authorize()
// only ever trusts a row where revokedAt is null (see
// TrustedDeviceService.isTrusted).
export const DELETE = withStandardHandler(async (req, session, json, { params }) => {
    const isSuperAdmin = session.user.role === 'SUPER_ADMIN'

    const device = await prisma.trustedDevice.findUnique({ where: { id: params.id } })
    if (!device) return ApiResponse.notFound("Device not found")

    const owns = isSuperAdmin ? device.superAdminId === session.user.id : device.userId === session.user.id
    if (!owns) return ApiResponse.forbidden("Not your device")

    await prisma.trustedDevice.update({ where: { id: params.id }, data: { revokedAt: new Date() } })
    return ApiResponse.success({ id: params.id })
})
