import type { Prisma } from "@prisma/client"
import type { Session } from "next-auth"
import { prisma } from "@/lib/prisma"
import { can, grantFor, type Actor } from "@/lib/permissions/can"
import { assignedToTeamWhere } from "@/lib/team-scope"
import { dayRangeIn } from "@/lib/services/filter-zone"
import { cents } from "@/lib/task-costs"
import { CHARGE_STATUSES, SERVICE_FEE_MAX, type ChargeStatus } from "@/lib/charges"

/**
 * What a task's clients owe for its costs (CLIENTS_PLAN.md §6): a cost on a
 * task with a client is charged to that client, so a charge follows its
 * task's client and isn't stored apart. The cost keeps the service fee on
 * top of it, whether it's left off the bill, and when it was collected.
 */

/** The Charged to clients tab's filters, as its address carries them (§6.4). */
export type ChargeFilters = {
    /** A Super Admin's chosen company; every company's without one. */
    companyId?: string
    clientId?: string
    dateFrom?: string
    dateTo?: string
    status?: string
    search?: string
}

/** The status asked for, or Due, as the tab opens. */
export function chargeStatus(raw: unknown): ChargeStatus {
    return CHARGE_STATUSES.includes(raw as ChargeStatus) ? raw as ChargeStatus : "due"
}

const BY_STATUS: Record<ChargeStatus, Prisma.TaskCostWhereInput> = {
    due: { notCharged: false, collectedAt: null },
    collected: { collectedAt: { not: null } },
    not_charged: { notCharged: true },
    all: {},
}

/**
 * Which charges this person sees, filtered: their company's, or a Super
 * Admin's chosen one's, or with See charges for their team, their team's
 * tasks'. Null when there's nothing to list.
 */
export async function chargesWhere(user: Actor & { id: string }, filters: ChargeFilters): Promise<Prisma.TaskCostWhereInput | null> {
    if (!can(user, "charges.view")) return null
    const companyId = user.role === "SUPER_ADMIN" ? filters.companyId || null : user.companyId
    if (companyId === undefined) return null
    const task: Prisma.TaskWhereInput = { clientId: filters.clientId || { not: null } }
    if (companyId) task.companyId = companyId
    if (grantFor(user, "charges.view") === "TEAM") Object.assign(task, assignedToTeamWhere(user.id))
    const AND: Prisma.TaskCostWhereInput[] = [{ task }, BY_STATUS[chargeStatus(filters.status)]]
    // The day it was added, where the company is.
    const createdAt = await dayRangeIn(filters.dateFrom, filters.dateTo, companyId)
    if (createdAt) AND.push({ createdAt })
    if (filters.search) AND.push({ OR: [
        { description: { contains: filters.search, mode: "insensitive" } },
        { task: { title: { contains: filters.search, mode: "insensitive" } } },
    ] })
    return { AND }
}

/**
 * The list's totals, every page of it (§6.4): what was paid out and the
 * service fees on top, of the charges in it, and what of them is still due.
 * One left off the bill counts in none.
 */
export async function chargeTotals(where: Prisma.TaskCostWhereInput) {
    const [charged, due] = await Promise.all([
        prisma.taskCost.aggregate({ where: { AND: [where, { notCharged: false }] }, _sum: { amount: true, serviceFee: true } }),
        prisma.taskCost.aggregate({ where: { AND: [where, BY_STATUS.due] }, _sum: { amount: true, serviceFee: true } }),
    ])
    return {
        paidOut: cents(Number(charged._sum.amount ?? 0)),
        serviceFees: cents(Number(charged._sum.serviceFee ?? 0)),
        totalDue: cents(Number(due._sum.amount ?? 0) + Number(due._sum.serviceFee ?? 0)),
    }
}

/** A charge as the tab lists it. */
export const CHARGE_ROW = {
    id: true, amount: true, serviceFee: true, description: true, authorName: true, receiptUrl: true,
    notCharged: true, collectedAt: true, createdAt: true,
    task: { select: { id: true, title: true, client: { select: { id: true, name: true } } } },
} satisfies Prisma.TaskCostSelect

/** An amount as sent: a number, or one typed, to the piastre. */
function amountOf(raw: unknown): number | null {
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw
    return typeof value === "number" && Number.isFinite(value) ? cents(value) : null
}

export class ChargeService {
    /**
     * A charge, held while it's changed, for whoever manages its company's
     * charges: refused if it's gone, isn't a charge (its task has no client),
     * or was collected, as a collected charge is locked (§6.5).
     */
    private static async held(tx: Prisma.TransactionClient, session: Session, costId: string) {
        if (typeof costId !== "string" || !costId) throw new Error("CHARGE_NOT_FOUND")
        await tx.$queryRaw`SELECT id FROM "TaskCost" WHERE id = ${costId} FOR UPDATE`
        const cost = await tx.taskCost.findUnique({
            where: { id: costId },
            select: { id: true, taskId: true, amount: true, serviceFee: true, notCharged: true, collectedAt: true, task: { select: { companyId: true, clientId: true } } },
        })
        // Another company's is none of theirs, so it's not there.
        if (!cost || !cost.task.clientId || !can(session.user as Actor, "charges.manage", { companyId: cost.task.companyId })) throw new Error("CHARGE_NOT_FOUND")
        if (cost.collectedAt) throw new Error("CHARGE_COLLECTED")
        return cost
    }

    private static audit(tx: Prisma.TransactionClient, session: Session, action: string, taskId: string, details: Record<string, unknown>) {
        const superAdmin = session.user.role === "SUPER_ADMIN"
        return tx.auditLog.create({
            data: { action, entityType: "TASK", entityId: taskId, userId: superAdmin ? null : session.user.id, superAdminId: superAdmin ? session.user.id : null, details: details as Prisma.InputJsonValue },
        })
    }

    /**
     * Sets a charge's service fee (§6.3): the fee as typed, or what makes the
     * total typed. Never negative, so the total is never below what was paid.
     */
    static async setServiceFee(session: Session, costId: string, input: { serviceFee?: unknown; total?: unknown }) {
        return prisma.$transaction(async tx => {
            const cost = await ChargeService.held(tx, session, costId)
            if (cost.notCharged) throw new Error("CHARGE_NOT_CHARGED")
            const paid = Number(cost.amount)
            let fee: number | null
            if (input.total !== undefined) {
                const total = amountOf(input.total)
                if (total === null) throw new Error("CHARGE_FEE_INVALID")
                fee = cents(total - paid)
                if (fee < 0) throw new Error("CHARGE_TOTAL_BELOW_PAID")
            } else {
                fee = amountOf(input.serviceFee)
            }
            if (fee === null || fee < 0 || fee > SERVICE_FEE_MAX) throw new Error("CHARGE_FEE_INVALID")
            const before = Number(cost.serviceFee)
            const saved = await tx.taskCost.update({ where: { id: cost.id }, data: { serviceFee: fee }, select: { id: true, serviceFee: true } })
            await ChargeService.audit(tx, session, "SET_SERVICE_FEE", cost.taskId, { costId: cost.id, from: before, to: fee })
            return { id: saved.id, serviceFee: Number(saved.serviceFee), total: cents(paid + Number(saved.serviceFee)) }
        })
    }

    /** "Not charged to client" (§6.2): leaves a cost off its client's bill, or charges it again. */
    static async setNotCharged(session: Session, costId: string, notCharged: unknown) {
        if (typeof notCharged !== "boolean") throw new Error("CHARGE_TICK_INVALID")
        return prisma.$transaction(async tx => {
            const cost = await ChargeService.held(tx, session, costId)
            const saved = await tx.taskCost.update({ where: { id: cost.id }, data: { notCharged }, select: { id: true, notCharged: true } })
            if (cost.notCharged !== notCharged) await ChargeService.audit(tx, session, "SET_NOT_CHARGED", cost.taskId, { costId: cost.id, notCharged })
            return saved
        })
    }
}
