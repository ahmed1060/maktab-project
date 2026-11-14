import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { TerminalBrandService } from "@/lib/services/terminal-brand.service"
import { terminalBrandSchema } from "@/lib/validations/terminal-brand.schema"

/** Terminal brands, kept by the Super Admin for every company (ATTENDANCE_PLAN.md §17.9). */

export const GET = withStandardHandler(async (_req, session) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    return ApiResponse.success({ brands: await TerminalBrandService.list() })
})

export const POST = withStandardHandler(async (_req, session, json) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    const validation = terminalBrandSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await TerminalBrandService.create(validation.data, session.user.id), 201)
})
