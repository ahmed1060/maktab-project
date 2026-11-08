import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { canCompanyWide, type Actor } from "@/lib/permissions/can"
import { filterTimeZone } from "@/lib/services/filter-zone"
import { dayRange } from "@/lib/day-range"
import { calendarDateStr } from "@/lib/time"
import { cents } from "@/lib/task-costs"
import { STATEMENT_MAX_CHARGES, numberReceipts, statementPeriod, statementTotals, type Statement } from "@/lib/client-statement"

/**
 * A client's statement (CLIENTS_PLAN.md §6.9; DESIGN.md §5.5, Client
 * statement): the charges added to its tasks in a period, in the company's
 * own days, and not left off its bill, oldest first, each as it is today;
 * and what's still due from before the period.
 *
 * Only for whoever sees all the company's charges. A Team Leader sees their
 * team's tasks' only, and a statement that left some out would mislead the
 * client it's sent to. Read from the client's own company, so a Super Admin
 * gets any client's, whichever company they picked.
 */
export async function clientStatement(user: Actor & { id: string }, input: { clientId?: string; from?: string; to?: string }, now: Date = new Date()): Promise<Statement> {
    if (!input.clientId) throw new Error("STATEMENT_CLIENT_REQUIRED")
    if (!canCompanyWide(user, "charges.view")) throw new Error("STATEMENT_COMPANY_WIDE")
    const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true, name: true, ownerName: true, companyId: true } })
    if (!client || (user.role !== "SUPER_ADMIN" && client.companyId !== user.companyId)) throw new Error("CLIENT_NOT_FOUND")

    const [company, timeZone] = await Promise.all([
        prisma.company.findUnique({ where: { id: client.companyId }, select: { name: true, logoUrl: true } }),
        filterTimeZone(client.companyId),
    ])
    const issuedOn = calendarDateStr(now, timeZone)
    const period = statementPeriod(input.from, input.to, issuedOn)
    // Both of its days are days, so both ends are there.
    const range = dayRange(period.from, period.to, timeZone) as { gte: Date; lte: Date }
    const tasks: Prisma.TaskWhereInput = { clientId: client.id, companyId: client.companyId }

    const [rows, before] = await Promise.all([
        prisma.taskCost.findMany({
            where: { notCharged: false, createdAt: range, task: tasks },
            select: { id: true, amount: true, serviceFee: true, description: true, receiptUrl: true, collectedAt: true, createdAt: true, task: { select: { id: true, title: true } } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            // One more than it holds, to know when there are more.
            take: STATEMENT_MAX_CHARGES + 1,
        }),
        prisma.taskCost.aggregate({
            where: { notCharged: false, collectedAt: null, createdAt: { lt: range.gte }, task: tasks },
            _sum: { amount: true, serviceFee: true },
            _count: { _all: true },
        }),
    ])
    if (rows.length > STATEMENT_MAX_CHARGES) throw new Error("STATEMENT_TOO_MANY")

    const charges = numberReceipts(rows.map(r => {
        const [paid, fee] = [Number(r.amount), Number(r.serviceFee)]
        return {
            id: r.id,
            day: calendarDateStr(r.createdAt, timeZone),
            description: r.description,
            task: r.task,
            paid,
            fee,
            total: cents(paid + fee),
            collectedOn: r.collectedAt ? calendarDateStr(r.collectedAt, timeZone) : null,
            receiptUrl: r.receiptUrl,
        }
    }))
    return {
        company: { name: company?.name ?? "", logoUrl: company?.logoUrl ?? null },
        client: { id: client.id, name: client.name, ownerName: client.ownerName },
        period,
        issuedOn,
        charges,
        totals: statementTotals(charges, {
            amount: Number(before._sum.amount ?? 0) + Number(before._sum.serviceFee ?? 0),
            count: before._count._all,
        }),
    }
}
