import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { TerminalBrandService } from "@/lib/services/terminal-brand.service"
import { terminalBrandSchema } from "@/lib/validations/terminal-brand.schema"

/** Change a brand: its protocol only while no terminal has it (ATTENDANCE_PLAN.md §17.9). */
export const PUT = withStandardHandler(async (_req, session, json, context) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    const validation = terminalBrandSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await TerminalBrandService.update(context.params.id, validation.data, session.user.id))
})

/** Delete one no terminal has had; one a terminal has is retired instead. */
export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    await TerminalBrandService.remove(context.params.id, session.user.id)
    return ApiResponse.success({ deleted: true })
})
