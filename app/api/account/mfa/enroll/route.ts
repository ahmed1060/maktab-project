import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { MfaService } from "@/lib/services/mfa.service"

// F-27, Phase 4: generates a fresh TOTP secret + QR code. Nothing is
// persisted here — see MfaService.startEnrollment. Calling this again
// (e.g. the user closed the tab before scanning) just hands back a new
// secret; the old unconfirmed one was never saved, so there's nothing to
// clean up.
export const POST = withStandardHandler(async (req, session) => {
    const email = session.user.email
    if (!email) return ApiResponse.badRequest("Account has no email on file")

    const { secret, otpauthUrl, qrCodeDataUrl } = await MfaService.startEnrollment(email)
    return ApiResponse.success({ secret, otpauthUrl, qrCodeDataUrl })
})
