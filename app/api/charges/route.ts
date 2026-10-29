import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { CHARGE_ROW, chargeTotals, chargesWhere } from "@/lib/services/charge.service"

/**
 * The Charged to clients tab (CLIENTS_PLAN.md §6.4): a page of the charges
 * this person sees, filtered by client, the day each was added, status and
 * search, and what all of them come to.
 */
export const GET = withStandardHandler(async (req, session) => {
    const params = new URL(req.url).searchParams
    const read = (key: string) => params.get(key) || undefined
    const where = await chargesWhere(session.user as any, {
        companyId: read("companyId"), clientId: read("clientId"), dateFrom: read("dateFrom"), dateTo: read("dateTo"),
        status: read("status"), search: read("search")?.slice(0, 100),
    })
    const page = Math.max(1, parseInt(params.get("page") || "1") || 1)
    const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") || "20") || 20))
    if (!where) return ApiResponse.success({ data: [], total: 0, totalPages: 0, totals: { paidOut: 0, serviceFees: 0, totalDue: 0 } })
    const [rows, total, totals] = await Promise.all([
        prisma.taskCost.findMany({ where, select: CHARGE_ROW, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
        prisma.taskCost.count({ where }),
        chargeTotals(where),
    ])
    return ApiResponse.success({
        data: rows.map(r => ({ ...r, amount: Number(r.amount), serviceFee: Number(r.serviceFee) })),
        total,
        totalPages: Math.ceil(total / limit),
        totals,
    })
}, { permission: "charges.view" })
