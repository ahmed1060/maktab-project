import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { managesCompany } from "@/lib/payroll-scope"
import { PayrollDeliveryService } from "@/lib/services/payroll-delivery.service"

/**
 * Send a final settlement again.
 *
 * One document, on request, because the person it is about has left and cannot
 * sign in to fetch it themselves. That is the whole reason this exists as a
 * manager action rather than a self-service download.
 *
 * No batching and no resume marker: it is one send, and if it fails the person
 * asking is standing right there and will press it again. Rate-limited all the
 * same, because "press it again" is exactly how a mailbox gets hammered.
 */
export const POST = withStandardHandler(async (_req, session, _json, { params }) => {
    const settlement = await prisma.finalSettlement.findUnique({
        where: { id: params.id },
        select: { id: true, companyId: true },
    })
    if (!settlement) return ApiResponse.notFound("Settlement not found")

    if (!managesCompany(session.user.role, session.user.companyId, settlement.companyId)) {
        return ApiResponse.forbidden("Access denied")
    }

    const { outcome } = await PayrollDeliveryService.resendSettlement(settlement.id)
    if (outcome !== "SENT") {
        // Not an error — the address is one nobody can receive mail at, and
        // saying "sent" would be a lie somebody only finds out about later.
        return ApiResponse.badRequest("That address cannot receive mail")
    }

    return ApiResponse.success({ sent: true })
}, { rateLimit: { maxRequests: 10, windowMs: 60_000 } })
