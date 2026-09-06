import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"

/**
 * Fires the GitHub Actions restore workflow (.github/workflows/restore.yml)
 * via repository_dispatch — same pattern as the backup route. The workflow
 * always takes a fresh safety backup of current state first, before
 * touching anything.
 *
 * Requires GITHUB_DISPATCH_TOKEN, same token the backup route already uses.
 */
export const POST = withStandardHandler(async (req, session, body) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    const token = process.env.GITHUB_DISPATCH_TOKEN
    if (!token) {
        return ApiResponse.error("GITHUB_DISPATCH_TOKEN is not configured", 500)
    }

    const mode = body?.mode === 'specific' ? 'specific' : 'latest'
    const folder = mode === 'specific' ? body?.folder : undefined
    const baseName = mode === 'specific' ? body?.baseName : undefined

    if (mode === 'specific' && (!folder || !baseName)) {
        return ApiResponse.badRequest("folder and baseName are required when mode is 'specific'")
    }

    const res = await fetch(
        'https://api.github.com/repos/ahmed1060/maktab-project/dispatches',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
            body: JSON.stringify({
                event_type: 'manual-restore',
                client_payload: { requestedBy: session.user.email, mode, folder, baseName },
            }),
        }
    )

    if (!res.ok) return ApiResponse.error(`GitHub returned ${res.status}`, 502)
    return ApiResponse.success({ started: true })
}, {
    rateLimit: { maxRequests: 2, windowMs: 60 * 60 * 1000 },
    audit: { action: 'MANUAL_RESTORE', entityType: 'SYSTEM' },
})
