import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { TrustedDeviceService, TRUSTED_DEVICE_COOKIE } from "@/lib/services/trusted-device.service"

// F-27, Phase 5: called by the client right after a login that actually
// completed an MFA challenge, only when "remember this device" was
// checked. authorize() itself can't set response cookies (it only
// returns a user object or throws), so issuing the cookie has to happen
// here, in a normal route handler with a real Response to attach it to.
export const POST = withStandardHandler(async (req, session) => {
    const isSuperAdmin = session.user.role === 'SUPER_ADMIN'
    const token = await TrustedDeviceService.issue(
        isSuperAdmin ? { superAdminId: session.user.id } : { userId: session.user.id },
        req.headers.get('user-agent')
    )

    const response = ApiResponse.success({ trusted: true })
    response.cookies.set(TRUSTED_DEVICE_COOKIE, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60,
    })
    return response
})
