import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { assertStepUp } from "@/lib/step-up"
import { ChargeService } from "@/lib/services/charge.service"

/**
 * Mark collected (CLIENTS_PLAN.md §6.4): a client's Due charges as its page
 * lists them, exactly those the confirmation's digest names. It moves money,
 * so it asks for two-factor sign-in (§6.6).
 */
export const POST = withStandardHandler(async (_req, session, json) => {
    await assertStepUp(session, "charges.collect")
    const raw = json?.filters ?? {}
    const text = (value: unknown) => typeof value === "string" && value ? value : undefined
    const result = await ChargeService.collect(session, {
        companyId: text(raw.companyId), clientId: text(raw.clientId), dateFrom: text(raw.dateFrom), dateTo: text(raw.dateTo),
        search: text(raw.search)?.slice(0, 100),
    }, json?.digest)
    return ApiResponse.success(result)
}, { permission: "charges.collect" })
