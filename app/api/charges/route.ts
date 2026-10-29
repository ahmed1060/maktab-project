import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { CHARGE_ROW, chargeTotals, chargesWhere, toCollect, type ChargeFilters } from "@/lib/services/charge.service"

/**
 * The Charged to clients tab (CLIENTS_PLAN.md §6.4): a page of the charges
 * this person sees, filtered by client, the day each was added, status and
 * search, and what all of them come to. For one client, as its page lists
 * them, also what is Due and Collected whatever the status picked, and the
 * Due ones' confirmation for whoever may mark them collected.
 */
export const GET = withStandardHandler(async (req, session) => {
    const params = new URL(req.url).searchParams
    const read = (key: string) => params.get(key) || undefined
    const filters: ChargeFilters = {
        companyId: read("companyId"), clientId: read("clientId"), dateFrom: read("dateFrom"), dateTo: read("dateTo"),
        status: read("status"), search: read("search")?.slice(0, 100),
    }
    const where = await chargesWhere(session.user as any, filters)
    const page = Math.max(1, parseInt(params.get("page") || "1") || 1)
    const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") || "20") || 20))
    if (!where) return ApiResponse.success({ data: [], total: 0, totalPages: 0, totals: { paidOut: 0, serviceFees: 0, totalDue: 0, collected: 0 }, summary: null, collect: null })
    const everyStatus = filters.clientId ? await chargesWhere(session.user as any, { ...filters, status: "all" }) : null
    const [rows, total, totals, summary, collect] = await Promise.all([
        prisma.taskCost.findMany({ where, select: CHARGE_ROW, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
        prisma.taskCost.count({ where }),
        chargeTotals(where),
        everyStatus ? chargeTotals(everyStatus).then(t => ({ due: t.totalDue, collected: t.collected })) : null,
        toCollect(session.user as any, filters, where),
    ])
    return ApiResponse.success({
        data: rows.map(r => ({ ...r, amount: Number(r.amount), serviceFee: Number(r.serviceFee) })),
        total,
        totalPages: Math.ceil(total / limit),
        totals,
        summary,
        collect,
    })
}, { permission: "charges.view" })
