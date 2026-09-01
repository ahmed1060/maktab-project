import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"

/**
 * Fires the GitHub Actions backup workflow (.github/workflows/backup.yml) on
 * demand via `repository_dispatch`, so a super admin can trigger a backup
 * from the maintenance page instead of only from the Actions tab or the
 * daily schedule.
 *
 * Requires GITHUB_DISPATCH_TOKEN — a fine-grained GitHub personal access
 * token scoped to just this repository with "Contents: read and write" and
 * nothing else.
 */
export const POST = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    const token = process.env.GITHUB_DISPATCH_TOKEN
    if (!token) {
        return ApiResponse.error("GITHUB_DISPATCH_TOKEN is not configured", 500)
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
                event_type: 'manual-backup',
                client_payload: { requestedBy: session.user.email },
            }),
        }
    )

    if (!res.ok) return ApiResponse.error(`GitHub returned ${res.status}`, 502)
    return ApiResponse.success({ started: true })
}, {
    rateLimit: { maxRequests: 3, windowMs: 60 * 60 * 1000 },
    audit: { action: 'MANUAL_BACKUP', entityType: 'SYSTEM' },
})
