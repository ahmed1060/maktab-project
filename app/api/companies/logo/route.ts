import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { CompanyService } from "@/lib/services/company.service"
import { MAX_LOGO_BYTES, MAX_LOGO_DIMENSION, MIN_LOGO_DIMENSION } from "@/lib/company-logo"
import { maySettings } from "@/lib/company-settings-access"

/**
 * A company's logo, uploaded here rather than through /api/upload.
 *
 * Two reasons it is its own endpoint. The stored value must be a URL this app
 * minted — accepting one as a string on the company PUT would let a logo point
 * anywhere, and it is fetched by every user of that company on every page. And
 * the rules are narrower than the general uploader's: three image formats
 * checked by signature rather than by name, 1 MB rather than 4, and a pixel
 * bound, none of which belong on a route that also carries task attachments.
 *
 * The Super Admin sets any company's logo; a company's own people set theirs
 * when the Super Admin shows them the Branding tab (ATTENDANCE_PLAN.md §5.2).
 */

/** Whether this caller may change this company's logo. */
async function mayChangeLogo(session: any, companyId: string): Promise<boolean> {
    if (session.user.role === 'SUPER_ADMIN') return true
    const exposure = await CompanyService.settingsExposure(companyId)
    return !!exposure && maySettings(session.user, exposure, 'branding', 'edit')
}

function messageFor(reason: string, detail?: string): string {
    switch (reason) {
        case "empty":
            return "The file is empty."
        case "too_large":
            return `The logo must be under ${Math.round(MAX_LOGO_BYTES / 1024)} KB.`
        case "unreadable":
            // Deliberately names the accepted formats rather than only refusing
            // this one, which is what somebody holding an SVG needs to be told.
            return "That file is not a PNG, JPG or WebP image. SVG files are not accepted."
        case "too_big_pixels":
            return `The logo must be at most ${MAX_LOGO_DIMENSION}×${MAX_LOGO_DIMENSION} pixels${detail ? ` (this one is ${detail})` : ""}.`
        case "too_small_pixels":
            return `The logo must be at least ${MIN_LOGO_DIMENSION}×${MIN_LOGO_DIMENSION} pixels${detail ? ` (this one is ${detail})` : ""}.`
        default:
            return "That file cannot be used as a logo."
    }
}

export const POST = withStandardHandler(async (req, session) => {
    const form = await req.formData()
    const companyId = form.get('companyId')
    const file = form.get('file')

    if (typeof companyId !== 'string' || !companyId) return ApiResponse.badRequest("companyId is required")
    if (!(await mayChangeLogo(session, companyId))) return ApiResponse.forbidden()
    if (!(file instanceof File)) return ApiResponse.badRequest("file is required")

    // Read once, up front, and bound it before anything else touches the bytes.
    const bytes = Buffer.from(await file.arrayBuffer())

    try {
        const result = await CompanyService.setLogo(companyId, bytes, session)
        if (!result.ok) {
            const detail = 'info' in result ? `${result.info.width}×${result.info.height}` : undefined
            return ApiResponse.badRequest(messageFor(result.reason, detail))
        }
        return ApiResponse.success({ logoUrl: result.logoUrl })
    } catch (e: any) {
        if (e?.message === 'COMPANY_NOT_FOUND') return ApiResponse.notFound("Company not found")
        throw e
    }
}, {
    // Tighter than the general uploader's 20: this is somebody setting a logo
    // once per company, not a user attaching files to their work.
    rateLimit: { maxRequests: 10, windowMs: 60_000 }
})

export const DELETE = withStandardHandler(async (req, session) => {
    const companyId = new URL(req.url).searchParams.get('companyId')
    if (!companyId) return ApiResponse.badRequest("companyId is required")
    if (!(await mayChangeLogo(session, companyId))) return ApiResponse.forbidden()

    try {
        const result = await CompanyService.clearLogo(companyId, session)
        return ApiResponse.success({ logoUrl: result.logoUrl })
    } catch (e: any) {
        if (e?.message === 'COMPANY_NOT_FOUND') return ApiResponse.notFound("Company not found")
        throw e
    }
})
