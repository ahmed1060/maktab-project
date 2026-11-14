import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { TerminalBrandService } from "@/lib/services/terminal-brand.service"

/** Retire a brand: terminals that have it keep it; it isn't offered for new ones (ATTENDANCE_PLAN.md §17.9). */
export const POST = withStandardHandler(async (_req, session, _json, context) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    return ApiResponse.success(await TerminalBrandService.retire(context.params.id, session.user.id))
})
