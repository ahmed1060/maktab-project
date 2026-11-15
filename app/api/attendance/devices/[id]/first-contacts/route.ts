import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { TerminalFirstContactService } from "@/lib/services/terminal-first-contact.service"

/**
 * A terminal's first contacts, for the Super Admin alone
 * (ATTENDANCE_PLAN.md §17.8, PR 294): what it sent in its first requests,
 * to compare with what Nizmo expects. A company's own people are refused,
 * whatever they may do with its terminals.
 */
export const GET = withStandardHandler(async (_req, session, _json, { params }) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    const kept = await TerminalFirstContactService.list(params.id)
    if (!kept) return ApiResponse.notFound("Terminal not found")
    return ApiResponse.success(kept)
})
