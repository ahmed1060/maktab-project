import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import type { Session } from "next-auth"
import { prisma } from "@/lib/prisma"
import { can, grantFor, type Actor } from "@/lib/permissions/can"
import { assignedToTeamWhere } from "@/lib/team-scope"
import { dayRangeIn } from "@/lib/services/filter-zone"
import { cents } from "@/lib/task-costs"
import { assertStepUp } from "@/lib/step-up"
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
    let companyId = user.role === "SUPER_ADMIN" ? filters.companyId || null : user.companyId
    if (companyId === undefined) return null
    // One client's, as its page lists them: its company's, and its days, whichever a Super Admin picked.
    if (companyId === null && filters.clientId) companyId = (await prisma.client.findUnique({ where: { id: filters.clientId }, select: { companyId: true } }))?.companyId ?? null
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
 * service fees on top, of the charges in it, what of them is still due, and
 * what was collected. One left off the bill counts in none.
 */
export async function chargeTotals(where: Prisma.TaskCostWhereInput) {
    const [charged, due, collected] = await Promise.all([
        prisma.taskCost.aggregate({ where: { AND: [where, { notCharged: false }] }, _sum: { amount: true, serviceFee: true } }),
        prisma.taskCost.aggregate({ where: { AND: [where, BY_STATUS.due] }, _sum: { amount: true, serviceFee: true } }),
        prisma.taskCost.aggregate({ where: { AND: [where, BY_STATUS.collected] }, _sum: { amount: true, serviceFee: true } }),
    ])
    const total = (sum: { amount: unknown; serviceFee: unknown }) => cents(Number(sum.amount ?? 0) + Number(sum.serviceFee ?? 0))
    return {
        paidOut: cents(Number(charged._sum.amount ?? 0)),
        serviceFees: cents(Number(charged._sum.serviceFee ?? 0)),
        totalDue: total(due._sum),
        collected: total(collected._sum),
    }
}

/**
 * What Mark collected would collect (§6.4): the Due charges listed, every
 * page of them, how many, what they come to, and their digest, which the
 * confirmation sends back so exactly those are collected.
 */
export async function collectSnapshot(where: Prisma.TaskCostWhereInput, db: Pick<Prisma.TransactionClient, "taskCost"> = prisma) {
    const rows = await db.taskCost.findMany({ where: { AND: [where, BY_STATUS.due] }, select: { id: true, amount: true, serviceFee: true }, orderBy: { id: "asc" } })
    const parts = rows.map(r => ({ id: r.id, amount: Number(r.amount), serviceFee: Number(r.serviceFee) }))
    return {
        ids: parts.map(p => p.id),
        count: parts.length,
        amount: cents(parts.reduce((sum, p) => sum + p.amount + p.serviceFee, 0)),
        digest: createHash("sha256").update(parts.map(p => `${p.id}:${p.amount.toFixed(2)}:${p.serviceFee.toFixed(2)}`).join("\n")).digest("hex"),
    }
}

/**
 * Mark collected's confirmation, for whoever may collect: a client's Due
 * charges as listed, or none to offer.
 */
export async function toCollect(user: Actor, filters: ChargeFilters, where: Prisma.TaskCostWhereInput) {
    if (!filters.clientId || chargeStatus(filters.status) !== "due" || !can(user, "charges.collect")) return null
    const { count, amount, digest } = await collectSnapshot(where)
    return count > 0 ? { count, amount, digest } : null
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
     * A charge, held while it's changed, for whoever may change its company's
     * charges so: refused if it's gone, or isn't a charge (its task has no
     * client).
     */
    private static async held(tx: Prisma.TransactionClient, session: Session, costId: string, permission: "charges.manage" | "charges.collect") {
        if (typeof costId !== "string" || !costId) throw new Error("CHARGE_NOT_FOUND")
        // Its task first, then the cost, as deleting the task, changing its
        // client and removing a cost hold the task: none of them reads its
        // charges as they were while one changes. Charging a cost again
        // while its task was deleted had it deleted, charged.
        const [owner] = await tx.$queryRaw<{ taskId: string }[]>`SELECT "taskId" FROM "TaskCost" WHERE id = ${costId}`
        if (!owner) throw new Error("CHARGE_NOT_FOUND")
        await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${owner.taskId} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM "TaskCost" WHERE id = ${costId} FOR UPDATE`
        const cost = await tx.taskCost.findUnique({
            where: { id: costId },
            select: { id: true, taskId: true, amount: true, serviceFee: true, notCharged: true, collectedAt: true, task: { select: { companyId: true, clientId: true } } },
        })
        // Another company's is none of theirs, so it's not there.
        if (!cost || !cost.task.clientId || !can(session.user as Actor, permission, { companyId: cost.task.companyId })) throw new Error("CHARGE_NOT_FOUND")
        return cost
    }

    /** One that may be changed: a collected charge is locked (§6.5). */
    private static async open(tx: Prisma.TransactionClient, session: Session, costId: string) {
        const cost = await ChargeService.held(tx, session, costId, "charges.manage")
        if (cost.collectedAt) throw new Error("CHARGE_COLLECTED")
        return cost
    }

    private static audit(tx: Prisma.TransactionClient, session: Session, action: string, entity: { type: "TASK" | "CLIENT"; id: string }, details: Record<string, unknown>) {
        const superAdmin = session.user.role === "SUPER_ADMIN"
        return tx.auditLog.create({
            data: { action, entityType: entity.type, entityId: entity.id, userId: superAdmin ? null : session.user.id, superAdminId: superAdmin ? session.user.id : null, details: details as Prisma.InputJsonValue },
        })
    }

    /**
     * Sets a charge's service fee (§6.3): the fee as typed, or what makes the
     * total typed. Never negative, so the total is never below what was paid.
     */
    static async setServiceFee(session: Session, costId: string, input: { serviceFee?: unknown; total?: unknown }) {
        return prisma.$transaction(async tx => {
            const cost = await ChargeService.open(tx, session, costId)
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
            await ChargeService.audit(tx, session, "SET_SERVICE_FEE", { type: "TASK", id: cost.taskId }, { costId: cost.id, from: before, to: fee })
            return { id: saved.id, serviceFee: Number(saved.serviceFee), total: cents(paid + Number(saved.serviceFee)) }
        })
    }

    /** "Not charged to client" (§6.2): leaves a cost off its client's bill, or charges it again. */
    static async setNotCharged(session: Session, costId: string, notCharged: unknown) {
        if (typeof notCharged !== "boolean") throw new Error("CHARGE_TICK_INVALID")
        return prisma.$transaction(async tx => {
            const cost = await ChargeService.open(tx, session, costId)
            const saved = await tx.taskCost.update({ where: { id: cost.id }, data: { notCharged }, select: { id: true, notCharged: true } })
            if (cost.notCharged !== notCharged) await ChargeService.audit(tx, session, "SET_NOT_CHARGED", { type: "TASK", id: cost.taskId }, { costId: cost.id, notCharged })
            return saved
        })
    }

    /**
     * Mark collected (§6.4): a client's Due charges, exactly those listed, as
     * the confirmation's digest says, "Collect 7 charges, 3,450 EGP from Al
     * Noor". If the list has changed since, it's refused and shown again.
     * Moves money, so it asks for two-factor sign-in (§6.6).
     */
    static async collect(session: Session, filters: ChargeFilters, digest: unknown) {
        await assertStepUp(session, "charges.collect")
        if (!filters.clientId) throw new Error("CHARGE_CLIENT_REQUIRED")
        if (typeof digest !== "string" || !digest) throw new Error("CHARGE_CONFIRMATION_REQUIRED")
        // Another company's, or with no Mark charges collected, none are theirs.
        if (!can(session.user as Actor, "charges.collect")) throw new Error("CHARGE_NOT_FOUND")
        const where = await chargesWhere(session.user as Actor & { id: string }, { ...filters, status: "due" })
        if (!where) throw new Error("CHARGE_NOT_FOUND")
        return prisma.$transaction(async tx => {
            // Their tasks, in one order, then the charges, as a task's own
            // changes hold the task first: none of its charges changes, moves
            // to another client or goes with the task while they're collected.
            const tasks = await tx.taskCost.findMany({ where: { AND: [where, BY_STATUS.due] }, select: { taskId: true }, distinct: ["taskId"] })
            const taskIds = tasks.map(t => t.taskId).sort()
            if (taskIds.length) await tx.$queryRaw`SELECT id FROM "Task" WHERE id IN (${Prisma.join(taskIds)}) ORDER BY id FOR UPDATE`
            const listed = await collectSnapshot(where, tx)
            if (listed.digest !== digest || listed.count === 0) throw new Error("CHARGE_LIST_CHANGED")
            await tx.$queryRaw`SELECT id FROM "TaskCost" WHERE id IN (${Prisma.join(listed.ids)}) ORDER BY id FOR UPDATE`
            const done = await tx.taskCost.updateMany({
                where: { id: { in: listed.ids }, ...BY_STATUS.due },
                data: { collectedAt: new Date(), collectedById: session.user.id },
            })
            if (done.count !== listed.count) throw new Error("CHARGE_LIST_CHANGED")
            await ChargeService.audit(tx, session, "COLLECT_CHARGES", { type: "CLIENT", id: filters.clientId! }, { count: listed.count, amount: listed.amount, costIds: listed.ids })
            return { count: listed.count, amount: listed.amount }
        })
    }

    /**
     * Mark uncollected (§6.5): a collected charge due again, so it can be
     * corrected; the audit log keeps both steps. Asks for two-factor sign-in,
     * as collecting does.
     */
    static async uncollect(session: Session, costId: string) {
        await assertStepUp(session, "charges.collect")
        return prisma.$transaction(async tx => {
            const cost = await ChargeService.held(tx, session, costId, "charges.collect")
            if (!cost.collectedAt) throw new Error("CHARGE_NOT_COLLECTED")
            const saved = await tx.taskCost.update({ where: { id: cost.id }, data: { collectedAt: null, collectedById: null }, select: { id: true, collectedAt: true } })
            await ChargeService.audit(tx, session, "UNCOLLECT_CHARGE", { type: "TASK", id: cost.taskId }, { costId: cost.id, collectedAt: cost.collectedAt.toISOString() })
            return saved
        })
    }
}
