import { Prisma } from "@prisma/client"
import type { Session } from "next-auth"
import { prisma } from "@/lib/prisma"
import { can, grantFor, type Actor } from "@/lib/permissions/can"
import { teamMemberWhere } from "@/lib/team-scope"
import { assertStepUp } from "@/lib/step-up"
import { cents } from "@/lib/task-costs"
import { calendarDateStr } from "@/lib/time"
import { filterTimeZone } from "@/lib/services/filter-zone"
import { uploadedHere } from "@/lib/services/cost-receipts"
import type { Paging } from "@/lib/pagination"
import { owedTo } from "@/lib/services/costs-query"
import { companyHasModule } from "@/lib/services/company-package"
import {
    CASH_ADVANCE_NOTE_MAX, HANDOVER_FOLDER, RECORDED_KINDS, balanceAfter, cashAdvancesInUse, dayOf, forOf, signedAmount, type AdvanceFor, type RecordedKind,
} from "@/lib/cash-advances"

/**
 * Cash advances (CLIENTS_PLAN.md §7): money a company gives an employee up
 * front, to pay task costs from. Every movement is an entry, never edited,
 * and a balance is always the sum of its person's entries (§7.4).
 *
 * Each entry is for one task or one client, or neither (§7.9): what's held
 * for each is that part's entries' sum, never below zero, and the running
 * balance is what's for neither. A balance is all of it.
 */

/** A task decided: an advance isn't given for it any more (§7.9). */
const DECIDED = ["APPROVED", "COMPLETED"] as const

/** Whose contract has ended: they hold no advance money, so what comes back to them is a debt (§7.3). */
const GONE = "ARCHIVED"

/** A debt's source when it's what someone still held on leaving (§7.3). */
export const CASH_ADVANCE_DEBT = "CASH_ADVANCE"

/** At work: not suspended, deleted or gone, so an advance may be given (§7.4). */
const AT_WORK = ["ACTIVE", "OFFLINE"] as const

type Db = Prisma.TransactionClient | typeof prisma

/** What a cost takes from one part of its author's advance (§7.9): its task's money, its client's, or the running balance. */
export type SpentPart = AdvanceFor & { amount: number }

/** What a cost took from its author's advance, all parts together: its From advance. */
export function spentTotal(parts: readonly SpentPart[]): number {
    return cents(parts.reduce((sum, p) => sum + p.amount, 0))
}

/** The Cash advances tab's filters (§7.5, §7.8). */
export type CashAdvanceFilters = {
    /** A Super Admin's chosen company: they pick one first. */
    companyId?: string
    search?: string
    /** Only those holding an advance. */
    holding?: boolean
}

/** What a person records (§7.3, §7.4), as sent. */
export type CashAdvanceInput = { kind?: unknown; amount?: unknown; date?: unknown; note?: unknown; photoUrl?: unknown; forTaskId?: unknown; forClientId?: unknown }

const PERSON = { id: true, firstName: true, lastName: true, status: true, companyId: true, teamLeaderId: true, role: true } satisfies Prisma.UserSelect

const ENTRY = {
    id: true, kind: true, amount: true, date: true, note: true, photoUrl: true, confirmedAt: true, recordedByName: true, createdAt: true,
    // A Spent one's task, while it's there (§7.4).
    task: { select: { id: true, title: true } },
    // What the money is for, while it's there (§7.9).
    forTask: { select: { id: true, title: true } },
    forClient: { select: { id: true, name: true } },
} satisfies Prisma.CashAdvanceEntrySelect

function nameOf(person: { firstName: string; lastName: string }) {
    return `${person.firstName} ${person.lastName}`.trim()
}

function entryOf(entry: Prisma.CashAdvanceEntryGetPayload<{ select: typeof ENTRY }>) {
    const amount = Number(entry.amount)
    return {
        ...entry, amount, date: entry.date.toISOString().slice(0, 10),
        // Taken from a task or a client since deleted (§7.9, 7g): a Moved
        // entry is always taken from one, so one taken from neither had it.
        partGone: entry.kind === "MOVED" && amount < 0 && !entry.forTask && !entry.forClient,
    }
}

/** Whether this company uses cash advances; refused as not otherwise (§7.6). */
async function inUse(companyId: string, db: Db = prisma) {
    const company = await db.company.findUnique({ where: { id: companyId }, select: { cashAdvancesAllowed: true, cashAdvancesOn: true } })
    if (!company) throw new Error("CASH_ADVANCE_NOT_FOUND")
    if (!cashAdvancesInUse(company)) throw new Error("CASH_ADVANCES_OFF")
}

/** A person's balance, as their entries add up (§7.4). */
async function balanceOf(db: Db, companyId: string, userId: string): Promise<number> {
    const sum = await db.cashAdvanceEntry.aggregate({ where: { companyId, userId }, _sum: { amount: true } })
    return cents(Number(sum._sum.amount ?? 0))
}

/** What a person holds for one part of their advance: a task, a client, or neither, the running balance (§7.9). */
async function partOf(db: Db, companyId: string, userId: string, part: AdvanceFor): Promise<number> {
    const sum = await db.cashAdvanceEntry.aggregate({ where: { companyId, userId, forTaskId: part.taskId, forClientId: part.clientId }, _sum: { amount: true } })
    return cents(Number(sum._sum.amount ?? 0))
}

/**
 * What a person holds for each task and each client (§7.9), with its task's
 * title or its client's name: those holding anything, tasks before clients.
 */
async function heldFor(db: Db, companyId: string, userId: string) {
    const parts = await db.cashAdvanceEntry.groupBy({
        by: ["forTaskId", "forClientId"],
        where: { companyId, userId, OR: [{ forTaskId: { not: null } }, { forClientId: { not: null } }] },
        _sum: { amount: true },
    })
    const held = parts.map(p => ({ forTaskId: p.forTaskId, forClientId: p.forClientId, amount: cents(Number(p._sum.amount ?? 0)) })).filter(p => p.amount !== 0)
    if (!held.length) return []
    const [tasks, clients] = await Promise.all([
        db.task.findMany({ where: { id: { in: held.flatMap(p => p.forTaskId ? [p.forTaskId] : []) } }, select: { id: true, title: true } }),
        db.client.findMany({ where: { id: { in: held.flatMap(p => p.forClientId ? [p.forClientId] : []) } }, select: { id: true, name: true } }),
    ])
    return held
        .map(p => ({
            forTask: p.forTaskId ? tasks.find(t => t.id === p.forTaskId) ?? null : null,
            forClient: p.forClientId ? clients.find(c => c.id === p.forClientId) ?? null : null,
            amount: p.amount,
            key: { taskId: p.forTaskId, clientId: p.forClientId },
        }))
        .sort((a, b) => Number(!!a.forClient) - Number(!!b.forClient) || (a.forTask?.title ?? a.forClient?.name ?? "").localeCompare(b.forTask?.title ?? b.forClient?.name ?? ""))
}

/**
 * What each cost took from each part of its author's advance (§7.9), as its
 * Spent entries say, to put back as it's removed. Whatever of what it took
 * its entries don't name a part for is the running balance's: a cost from
 * before 7f took it from there.
 */
async function takenBy(db: Db, costs: readonly { id: string; part: number }[]): Promise<Map<string, SpentPart[]>> {
    const sums = await db.cashAdvanceEntry.groupBy({
        by: ["costId", "forTaskId", "forClientId"],
        where: { kind: "SPENT", costId: { in: costs.map(c => c.id) } },
        _sum: { amount: true },
    })
    return new Map(costs.map(c => {
        const parts: SpentPart[] = sums
            .filter(s => s.costId === c.id && Number(s._sum.amount ?? 0) < 0 && (s.forTaskId || s.forClientId))
            .map(s => ({ taskId: s.forTaskId, clientId: s.forClientId, amount: cents(-Number(s._sum.amount ?? 0)) }))
        const rest = cents(c.part - parts.reduce((sum, p) => sum + p.amount, 0))
        return [c.id, rest > 0 ? [...parts, { taskId: null, clientId: null, amount: rest }] : parts]
    }))
}

/**
 * Each person's balance in a company, what of it is awaiting their
 * confirmation, and the day of their last movement: those with entries only.
 */
async function balancesIn(companyId: string) {
    const [sums, awaiting, running] = await Promise.all([
        prisma.cashAdvanceEntry.groupBy({ by: ["userId"], where: { companyId }, _sum: { amount: true }, _max: { date: true } }),
        prisma.cashAdvanceEntry.groupBy({ by: ["userId"], where: { companyId, kind: "GIVEN", confirmedAt: null }, _sum: { amount: true } }),
        prisma.cashAdvanceEntry.groupBy({ by: ["userId"], where: { companyId, forTaskId: null, forClientId: null }, _sum: { amount: true } }),
    ])
    const waiting = new Map(awaiting.map(a => [a.userId, cents(Number(a._sum.amount ?? 0))]))
    const free = new Map(running.map(r => [r.userId, cents(Number(r._sum.amount ?? 0))]))
    return new Map(sums.map(s => {
        const balance = cents(Number(s._sum.amount ?? 0))
        return [s.userId, {
            balance,
            // What of it is for a task or a client (§7.9).
            earmarked: cents(balance - (free.get(s.userId) ?? 0)),
            awaiting: waiting.get(s.userId) ?? 0,
            lastDate: s._max.date ? s._max.date.toISOString().slice(0, 10) : null,
        }]
    }))
}

/**
 * Today, where the company is: the last day an entry may be recorded on.
 * Inside a transaction, read through it: one waiting for a connection the
 * others hold, while they wait on its hold on an advance, never gets one.
 */
async function todayIn(companyId: string, db: Db = prisma): Promise<string> {
    return calendarDateStr(new Date(), await filterTimeZone(companyId, db))
}

/** Why what's held for a task or a client moved to the running balance (§7.9, 7g), as the audit log says. */
export type MovedBecause = "TASK_APPROVED" | "TASK_DELETED" | "CLIENT_ARCHIVED" | "CLIENT_DELETED" | "BY_HAND"

/** Whoever moved it: a user, or a Super Admin. */
export type Mover = { id: string; name?: string | null; role?: string }

/**
 * Moves all one person holds for one task or one client to their running
 * balance (§7.9, 7g): a pair of Moved entries, taken from the one and added
 * to the other, on today where the company is, and a line in the audit log.
 * What it moved, or nothing where they hold none. Under the hold on their
 * advance.
 */
async function movedToRunning(tx: Prisma.TransactionClient, companyId: string, userId: string, part: AdvanceFor, because: MovedBecause, by: Mover): Promise<number> {
    const amount = await partOf(tx, companyId, userId, part)
    if (amount <= 0) return 0
    const date = new Date(`${await todayIn(companyId, tx)}T00:00:00Z`)
    const entry = { companyId, userId, kind: "MOVED" as const, date, recordedById: by.id, recordedByName: by.name ?? null }
    await tx.cashAdvanceEntry.createMany({
        data: [
            { ...entry, amount: -amount, forTaskId: part.taskId, forClientId: part.clientId },
            { ...entry, amount },
        ],
    })
    const superAdmin = by.role === "SUPER_ADMIN"
    await tx.auditLog.create({
        data: {
            action: "MOVE_CASH_ADVANCE", entityType: "USER", entityId: userId,
            userId: superAdmin ? null : by.id, superAdminId: superAdmin ? by.id : null,
            details: { amount, because, ...(part.taskId && { forTaskId: part.taskId }), ...(part.clientId && { forClientId: part.clientId }) },
        },
    })
    return amount
}

/** A name's words, each in the first or last name. */
function nameMatches(search: string): Prisma.UserWhereInput[] {
    return search.split(/\s+/).filter(Boolean).slice(0, 5).map(word => ({ OR: [
        { firstName: { contains: word, mode: "insensitive" } },
        { lastName: { contains: word, mode: "insensitive" } },
    ] }))
}

export class CashAdvanceService {
    /**
     * The Cash advances tab (§7.5): everyone at work in the company, and
     * anyone else still holding money, each with their balance, what's
     * awaiting confirmation and their last movement. Its totals are every
     * page's. With See cash advances for their team, their team and
     * themselves.
     */
    static async list(user: Actor & { id: string }, filters: CashAdvanceFilters, paging: Paging) {
        const companyId = user.role === "SUPER_ADMIN" ? filters.companyId || null : user.companyId ?? null
        if (!companyId) throw new Error("CASH_ADVANCE_COMPANY_REQUIRED")
        if (!can(user, "cash_advances.view")) throw new Error("CASH_ADVANCE_NOT_FOUND")
        await inUse(companyId)

        const balances = await balancesIn(companyId)
        const holders = [...balances].filter(([, b]) => b.balance > 0).map(([id]) => id)
        const AND: Prisma.UserWhereInput[] = [
            { companyId, role: { not: "SUPER_ADMIN" } },
            filters.holding ? { id: { in: holders } } : { OR: [{ status: { in: [...AT_WORK] } }, { id: { in: holders } }] },
        ]
        if (grantFor(user, "cash_advances.view") === "TEAM") AND.push(teamMemberWhere(user.id))
        if (filters.search) AND.push(...nameMatches(filters.search))
        const where = { AND }

        const [people, all] = await Promise.all([
            prisma.user.findMany({ where, select: PERSON, orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }], skip: paging.skip, take: paging.limit }),
            prisma.user.findMany({ where, select: { id: true } }),
        ])
        const of = (id: string) => balances.get(id) ?? { balance: 0, earmarked: 0, awaiting: 0, lastDate: null }
        return {
            // The day an entry is recorded on as the form opens, and the last it may be: today where the company is.
            today: await todayIn(companyId),
            data: people.map(p => ({ id: p.id, name: nameOf(p), atWork: (AT_WORK as readonly string[]).includes(p.status), ...of(p.id) })),
            total: all.length,
            totalPages: Math.ceil(all.length / paging.limit),
            totals: {
                held: cents(all.reduce((sum, p) => sum + of(p.id).balance, 0)),
                awaiting: cents(all.reduce((sum, p) => sum + of(p.id).awaiting, 0)),
                holders: all.filter(p => of(p.id).balance > 0).length,
            },
        }
    }

    /**
     * One person's advance (§7.5): their balance and every entry, newest
     * first. Everyone sees their own, on My cash advance; anyone else's
     * takes See cash advances for them.
     */
    static async person(user: Actor & { id: string }, userId: string, paging: Paging) {
        const person = userId ? await prisma.user.findUnique({ where: { id: userId }, select: PERSON }) : null
        if (!person?.companyId || person.role === "SUPER_ADMIN") throw new Error("CASH_ADVANCE_NOT_FOUND")
        const target = { companyId: person.companyId, userId: person.id, teamLeaderId: person.teamLeaderId }
        if (person.id !== user.id && !can(user, "cash_advances.view", target)) throw new Error("CASH_ADVANCE_NOT_FOUND")
        await inUse(person.companyId)

        const where = { companyId: person.companyId, userId: person.id }
        const [entries, total, balance, running, held, awaiting] = await Promise.all([
            prisma.cashAdvanceEntry.findMany({ where, select: ENTRY, orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }], skip: paging.skip, take: paging.limit }),
            prisma.cashAdvanceEntry.count({ where }),
            balanceOf(prisma, person.companyId, person.id),
            partOf(prisma, person.companyId, person.id, { taskId: null, clientId: null }),
            heldFor(prisma, person.companyId, person.id),
            prisma.cashAdvanceEntry.aggregate({ where: { ...where, kind: "GIVEN", confirmedAt: null }, _sum: { amount: true } }),
        ])
        return {
            today: await todayIn(person.companyId),
            person: { id: person.id, name: nameOf(person), atWork: (AT_WORK as readonly string[]).includes(person.status) },
            balance,
            // The running balance, and what of the rest is for each task and client (§7.9).
            running,
            held: held.map(({ forTask, forClient, amount }) => ({ forTask, forClient, amount })),
            awaiting: cents(Number(awaiting._sum.amount ?? 0)),
            data: entries.map(entryOf),
            total,
            totalPages: Math.ceil(total / paging.limit),
            // Nobody gives or settles their own (§7.8): can() refuses it.
            canGive: can(user, "cash_advances.give", target),
            // What they're owed, offered at hand-over (§7.3).
            owed: person.id !== user.id ? await owedTo(user, person.id) : null,
        }
    }

    /**
     * Give advance, Record return or Correction (§7.3, §7.4): an entry on
     * the person's advance. An advance is given only to someone at work; a
     * return is never more than the balance, and a correction never takes it
     * below zero. Moves money, so it asks for two-factor sign-in (§7.7).
     *
     * Each is on one part of the advance (§7.9): the running balance, or
     * what's for one task or one client. An advance for a task goes only to
     * someone on it, while it isn't decided; one for a client, while it isn't
     * archived. A return or a correction is on a part they hold money in, and
     * never takes that part below zero.
     */
    static async record(session: Session, userId: string, input: CashAdvanceInput) {
        await assertStepUp(session, "cash_advances.give")
        const kind = RECORDED_KINDS.includes(input.kind as RecordedKind) ? input.kind as RecordedKind : null
        if (!kind) throw new Error("CASH_ADVANCE_KIND_INVALID")
        const amount = signedAmount(kind, input.amount)
        if (amount === null) throw new Error("CASH_ADVANCE_AMOUNT_INVALID")
        const date = dayOf(input.date)
        if (!date) throw new Error("CASH_ADVANCE_DATE_INVALID")
        const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null
        if (note && note.length > CASH_ADVANCE_NOTE_MAX) throw new Error("CASH_ADVANCE_NOTE_TOO_LONG")
        if (kind === "CORRECTION" && !note) throw new Error("CASH_ADVANCE_REASON_REQUIRED")
        const photoUrl = typeof input.photoUrl === "string" && input.photoUrl ? input.photoUrl : null
        if (input.photoUrl != null && input.photoUrl !== "" && (!photoUrl || kind !== "GIVEN")) throw new Error("CASH_ADVANCE_PHOTO_INVALID")
        const part = forOf(input)
        if (!part) throw new Error("CASH_ADVANCE_FOR_INVALID")

        const person = userId ? await prisma.user.findUnique({ where: { id: userId }, select: PERSON }) : null
        if (!person?.companyId || person.role === "SUPER_ADMIN") throw new Error("CASH_ADVANCE_NOT_FOUND")
        const companyId = person.companyId
        // Another company's, and one's own, are none of theirs (§7.8).
        if (!can(session.user as Actor, "cash_advances.give", { companyId, userId: person.id, teamLeaderId: person.teamLeaderId })) throw new Error("CASH_ADVANCE_NOT_FOUND")
        if (kind === "GIVEN" && !(AT_WORK as readonly string[]).includes(person.status)) throw new Error("CASH_ADVANCE_NOT_AT_WORK")
        // Today or before, where the company is.
        if (date > await todayIn(companyId)) throw new Error("CASH_ADVANCE_DATE_INVALID")
        const superAdmin = session.user.role === "SUPER_ADMIN"
        if (photoUrl && !(await uploadedHere([photoUrl], companyId, superAdmin, HANDOVER_FOLDER))) throw new Error("CASH_ADVANCE_PHOTO_INVALID")

        try {
            return await prisma.$transaction(async tx => {
                // The company first, so its switch can't go off while this is
                // recorded (CashAdvanceService.assertNoneHeld); then the
                // person's balance, one entry at a time.
                await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR KEY SHARE`
                await inUse(companyId, tx)
                await CashAdvanceService.lockPerson(tx, person.id)
                // Deleted for good while this waited: nothing is theirs any more.
                // And whether they're at work, or gone, as it is now: an ending
                // may have been recorded while this waited (§7.3).
                const now = await tx.user.findUnique({ where: { id: person.id }, select: { status: true } })
                if (!now) throw new Error("CASH_ADVANCE_NOT_FOUND")
                if (kind === "GIVEN" && !(AT_WORK as readonly string[]).includes(now.status)) throw new Error("CASH_ADVANCE_NOT_AT_WORK")
                await CashAdvanceService.assertFor(tx, kind, companyId, person.id, part)
                // That part never goes below zero, and so neither does the whole.
                const partAfter = balanceAfter(await partOf(tx, companyId, person.id, part), amount)
                if (partAfter === null) throw new Error(kind === "RETURNED" ? "CASH_ADVANCE_MORE_THAN_HELD" : "CASH_ADVANCE_BELOW_ZERO")
                const after = cents(await balanceOf(tx, companyId, person.id) + amount)
                const entry = await tx.cashAdvanceEntry.create({
                    data: {
                        companyId, userId: person.id, kind, amount, date: new Date(`${date}T00:00:00Z`), note, photoUrl,
                        forTaskId: part.taskId, forClientId: part.clientId,
                        recordedById: session.user.id, recordedByName: session.user.name ?? null,
                    },
                    select: ENTRY,
                })
                await tx.auditLog.create({
                    data: {
                        action: { GIVEN: "GIVE_CASH_ADVANCE", RETURNED: "RETURN_CASH_ADVANCE", CORRECTION: "CORRECT_CASH_ADVANCE" }[kind],
                        entityType: "USER", entityId: person.id,
                        userId: superAdmin ? null : session.user.id, superAdminId: superAdmin ? session.user.id : null,
                        details: { entryId: entry.id, amount, date, balance: after, ...(note && { note }), ...(part.taskId && { forTaskId: part.taskId }), ...(part.clientId && { forClientId: part.clientId }) },
                    },
                })
                // Someone whose contract has ended holds nothing: a correction
                // finding they held more makes it a debt, as at their leaving
                // (§7.3). Where the package has no Payroll, it stays on theirs.
                if (now.status === GONE && after > 0) {
                    const debt = await CashAdvanceService.toDebt(tx, companyId, person.id, null, { dueDate: new Date(), by: { id: session.user.id, name: session.user.name } })
                    if (debt) return { entry: entryOf(entry), balance: 0 }
                }
                return { entry: entryOf(entry), balance: after }
            })
        } catch (error) {
            // A photo is on one advance only.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new Error("CASH_ADVANCE_PHOTO_INVALID")
            throw error
        }
    }

    /**
     * Confirm receipt (§7.3): the employee says they received an advance,
     * once, so there's no later dispute over whether it was handed over.
     * Their own only.
     */
    static async confirm(session: Session, entryId: string) {
        const entry = entryId ? await prisma.cashAdvanceEntry.findUnique({ where: { id: entryId }, select: { id: true, userId: true, companyId: true, kind: true, amount: true, confirmedAt: true } }) : null
        if (!entry || entry.userId !== session.user.id || entry.kind !== "GIVEN") throw new Error("CASH_ADVANCE_NOT_FOUND")
        await inUse(entry.companyId)
        const confirmedAt = new Date()
        return prisma.$transaction(async tx => {
            const done = await tx.cashAdvanceEntry.updateMany({ where: { id: entry.id, confirmedAt: null }, data: { confirmedAt } })
            if (done.count === 0) throw new Error("CASH_ADVANCE_ALREADY_CONFIRMED")
            await tx.auditLog.create({
                data: { action: "CONFIRM_CASH_ADVANCE", entityType: "USER", entityId: entry.userId, userId: session.user.id, details: { entryId: entry.id, amount: Number(entry.amount) } },
            })
            return { id: entry.id, confirmedAt }
        })
    }

    /**
     * Whether this person's company uses cash advances, for the Costs page's
     * tab and the side bar's My cash advance. A Super Admin's tab asks them
     * to pick a company, so it's always there.
     */
    static async usedBy(user: Actor): Promise<boolean> {
        if (user.role === "SUPER_ADMIN") return true
        if (!user.companyId) return false
        return cashAdvancesInUse(await prisma.company.findUnique({ where: { id: user.companyId }, select: { cashAdvancesAllowed: true, cashAdvancesOn: true } }))
    }

    /**
     * Pays costs being added from their author's advance first (§7.2): each
     * the part the balance covers, in the order they're added, never more
     * than the cost. Only where the company uses cash advances, and only a
     * company person's: a Super Admin holds none. What each cost takes from
     * each part, which spent() then records once the costs are there. Holds
     * the company and the person's advance, as recording an entry does.
     *
     * The money for the cost's task goes first, then for its task's client,
     * then the running balance (§7.9): the narrowest first. Money for any
     * other task or client isn't touched.
     */
    static async spendFor(
        tx: Prisma.TransactionClient,
        author: { id: string; role?: string | null },
        companyId: string | null,
        amounts: readonly number[],
        on: { taskId: string; clientId: string | null },
    ): Promise<SpentPart[][]> {
        const none = amounts.map((): SpentPart[] => [])
        if (!companyId || author.role === "SUPER_ADMIN") return none
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR KEY SHARE`
        const company = await tx.company.findUnique({ where: { id: companyId }, select: { cashAdvancesAllowed: true, cashAdvancesOn: true } })
        if (!cashAdvancesInUse(company)) return none
        await CashAdvanceService.lockPerson(tx, author.id)
        const order: AdvanceFor[] = [
            { taskId: on.taskId, clientId: null },
            ...(on.clientId ? [{ taskId: null, clientId: on.clientId }] : []),
            { taskId: null, clientId: null },
        ]
        const left: number[] = []
        for (const part of order) left.push(Math.max(0, await partOf(tx, companyId, author.id, part)))
        return amounts.map(amount => {
            let due = cents(amount)
            const taken: SpentPart[] = []
            order.forEach((part, i) => {
                const take = cents(Math.min(left[i], due))
                if (take <= 0) return
                left[i] = cents(left[i] - take)
                due = cents(due - take)
                taken.push({ ...part, amount: take })
            })
            return taken
        })
    }

    /**
     * Spent entries for costs paid from an advance (§7.4): taken off as they
     * were added (way -1), one for each part a cost took from (§7.9), or put
     * back as they're removed (way 1), each on the part its cost took it
     * from, as the cost's own entries say. What a cost from before 7f took
     * named no part: it goes back on the running balance, where it came
     * from. One put back is put back whether or not the company still uses
     * cash advances: the money is the person's again.
     */
    static async spent(
        tx: Prisma.TransactionClient,
        companyId: string,
        taskId: string,
        costs: readonly { id: string; authorId: string | null; part: number; parts?: readonly SpentPart[] }[],
        way: -1 | 1,
        by: { id: string; name?: string | null },
    ) {
        let paid = costs.filter((c): c is { id: string; authorId: string; part: number; parts?: readonly SpentPart[] } => !!c.authorId && c.part > 0)
        if (!paid.length) return
        let gone: string[] = []
        let taken = new Map<string, SpentPart[]>(paid.map(c => [c.id, [...(c.parts ?? [{ taskId: null, clientId: null, amount: c.part }])]]))
        if (way === 1) {
            // Each person's advance held, in one order, so two removals don't wait on each other.
            const authors = [...new Set(paid.map(c => c.authorId))].sort()
            for (const authorId of authors) await CashAdvanceService.lockPerson(tx, authorId)
            // Someone deleted for good since has no advance to put it back on:
            // theirs went with them, held at nothing (UserService.delete).
            const here = await tx.user.findMany({ where: { id: { in: authors } }, select: { id: true, status: true } })
            paid = paid.filter(c => here.some(u => u.id === c.authorId))
            if (!paid.length) return
            gone = here.filter(u => u.status === GONE).map(u => u.id)
            taken = await takenBy(tx, paid)
        }
        const date = new Date(`${await todayIn(companyId, tx)}T00:00:00Z`)
        await tx.cashAdvanceEntry.createMany({
            data: paid.flatMap(c => (taken.get(c.id) ?? []).map(p => ({
                companyId, userId: c.authorId, kind: "SPENT" as const, amount: cents(way * p.amount), date,
                costId: c.id, taskId, forTaskId: p.taskId, forClientId: p.clientId, recordedById: by.id, recordedByName: by.name ?? null,
            }))),
        })
        // Someone whose contract has ended holds nothing: what's put back on
        // theirs becomes a debt at once, as at their leaving (§7.3), where the
        // package has Payroll (toDebt).
        for (const userId of gone) await CashAdvanceService.toDebt(tx, companyId, userId, null, { dueDate: new Date(), by })
    }

    /**
     * Leaving the company (§7.3): what they still hold becomes a debt,
     * recovered as other debts are. An entry of its own takes the balance to
     * nothing, and the debt names it as its source. Under the hold on their
     * advance each entry is recorded under; `counted` is what the settlement
     * counted, and anything else since is refused, as the statement would no
     * longer add up. Null counts whatever they hold, as an ending dated ahead
     * takes effect. Null when nothing is held.
     *
     * Debts are payroll's, recovered through payroll or the final settlement,
     * so whatever they hold becomes one only where the company's package
     * includes Payroll. Without it, nothing could recover the debt and no
     * screen there shows one: the balance stays theirs, on the Cash advances
     * tab, until its return is recorded, and this is null. What a settlement
     * counted is a debt all the same: a settlement is only worked out where
     * there's Payroll (SettlementService.preview).
     */
    static async toDebt(
        tx: Prisma.TransactionClient,
        companyId: string,
        userId: string,
        counted: number | null,
        debt: { dueDate: Date; by: { id: string; name?: string | null } },
    ) {
        if (counted === null && !(await companyHasModule(companyId, "PAYROLL", tx))) return null
        await CashAdvanceService.lockPerson(tx, userId)
        const held = await balanceOf(tx, companyId, userId)
        if (counted !== null && held !== cents(counted)) throw new Error("CASH_ADVANCE_CHANGED")
        if (held <= 0) return null
        // What's for a task or a client is moved to the running balance first
        // (§7.9), so each part comes to nothing with the whole.
        await CashAdvanceService.moveToRunning(tx, companyId, userId, debt.by)
        const entry = await tx.cashAdvanceEntry.create({
            data: {
                companyId, userId, kind: "DEBT", amount: -held, date: new Date(`${await todayIn(companyId, tx)}T00:00:00Z`),
                recordedById: debt.by.id, recordedByName: debt.by.name ?? null,
            },
            select: { id: true },
        })
        return tx.debt.create({
            data: { userId, companyId, amount: held, source: CASH_ADVANCE_DEBT, sourceId: entry.id, dueDate: debt.dueDate },
        })
    }

    /**
     * What an advance for this person can be for (§7.9): the open tasks
     * they're on, and the company's clients not archived, by name. For
     * whoever may give them an advance.
     */
    static async purposes(user: Actor & { id: string }, userId: string) {
        const person = userId ? await prisma.user.findUnique({ where: { id: userId }, select: PERSON }) : null
        if (!person?.companyId || person.role === "SUPER_ADMIN") throw new Error("CASH_ADVANCE_NOT_FOUND")
        const companyId = person.companyId
        if (!can(user, "cash_advances.give", { companyId, userId: person.id, teamLeaderId: person.teamLeaderId })) throw new Error("CASH_ADVANCE_NOT_FOUND")
        await inUse(companyId)
        const [tasks, clients] = await Promise.all([
            prisma.task.findMany({
                where: { companyId, status: { notIn: [...DECIDED] }, assignees: { some: { id: person.id } } },
                select: { id: true, title: true },
                orderBy: [{ deadline: "asc" }, { title: "asc" }, { id: "asc" }],
            }),
            prisma.client.findMany({ where: { companyId, archivedAt: null }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
        ])
        return { tasks, clients }
    }

    /**
     * Whether an entry may be on this part of a person's advance (§7.9). An
     * advance for a task: one of the company's, the person on it, not yet
     * decided. For a client: one of the company's, not archived. A return or
     * a correction: a part they hold money in, or have.
     */
    static async assertFor(tx: Prisma.TransactionClient, kind: RecordedKind, companyId: string, userId: string, part: AdvanceFor) {
        if (!part.taskId && !part.clientId) return
        if (kind !== "GIVEN") {
            const has = await tx.cashAdvanceEntry.count({ where: { companyId, userId, forTaskId: part.taskId, forClientId: part.clientId } })
            if (!has) throw new Error("CASH_ADVANCE_FOR_INVALID")
            return
        }
        if (part.taskId) {
            const task = await tx.task.findFirst({ where: { id: part.taskId, companyId }, select: { status: true, assignees: { where: { id: userId }, select: { id: true } } } })
            if (!task) throw new Error("CASH_ADVANCE_FOR_INVALID")
            if ((DECIDED as readonly string[]).includes(task.status)) throw new Error("CASH_ADVANCE_TASK_DONE")
            if (!task.assignees.length) throw new Error("CASH_ADVANCE_NOT_ON_TASK")
        } else {
            const client = await tx.client.findFirst({ where: { id: part.clientId!, companyId }, select: { archivedAt: true } })
            if (!client) throw new Error("CASH_ADVANCE_FOR_INVALID")
            if (client.archivedAt) throw new Error("CASH_ADVANCE_CLIENT_ARCHIVED")
        }
    }

    /**
     * Moves what a person holds for each task and client to their running
     * balance (§7.9): a pair of Moved entries for each, taken from the one
     * and added to the other. Under the hold on their advance.
     */
    static async moveToRunning(tx: Prisma.TransactionClient, companyId: string, userId: string, by: { id: string; name?: string | null }) {
        const held = await heldFor(tx, companyId, userId)
        if (!held.length) return
        const date = new Date(`${await todayIn(companyId, tx)}T00:00:00Z`)
        const entry = { companyId, userId, kind: "MOVED" as const, date, recordedById: by.id, recordedByName: by.name ?? null }
        await tx.cashAdvanceEntry.createMany({
            data: held.flatMap(h => [
                { ...entry, amount: -h.amount, forTaskId: h.key.taskId, forClientId: h.key.clientId },
                { ...entry, amount: h.amount },
            ]),
        })
    }

    /**
     * Moves what everyone holds for one task or one client to their running
     * balance (§7.9, 7g): as the task is approved or deleted, or the client
     * archived or deleted. Each person's advance is held in the order of
     * their ids, so no cost spends it meanwhile and two moves can't wait on
     * each other, and what they hold is read again under it.
     */
    static async movePart(tx: Prisma.TransactionClient, companyId: string, part: AdvanceFor, because: MovedBecause, by: Mover) {
        if (!part.taskId && !part.clientId) return
        const holders = await tx.cashAdvanceEntry.findMany({
            where: { companyId, forTaskId: part.taskId, forClientId: part.clientId },
            distinct: ["userId"],
            select: { userId: true },
        })
        for (const userId of holders.map(h => h.userId).sort()) {
            await CashAdvanceService.lockPerson(tx, userId)
            await movedToRunning(tx, companyId, userId, part, because, by)
        }
    }

    /**
     * Move to running balance, by hand (§7.9, 7g): all a person holds for one
     * task or one client, for a task that's stuck or won't be finished, as
     * for a client. For whoever may give and settle their advances, with
     * two-factor sign-in, as any entry that moves money.
     */
    static async move(session: Session, userId: string, input: { forTaskId?: unknown; forClientId?: unknown }) {
        await assertStepUp(session, "cash_advances.give")
        const part = forOf(input)
        if (!part || (!part.taskId && !part.clientId)) throw new Error("CASH_ADVANCE_FOR_INVALID")
        const person = userId ? await prisma.user.findUnique({ where: { id: userId }, select: PERSON }) : null
        if (!person?.companyId || person.role === "SUPER_ADMIN") throw new Error("CASH_ADVANCE_NOT_FOUND")
        const companyId = person.companyId
        // Another company's, and one's own, are none of theirs (§7.8).
        if (!can(session.user as Actor, "cash_advances.give", { companyId, userId: person.id, teamLeaderId: person.teamLeaderId })) throw new Error("CASH_ADVANCE_NOT_FOUND")
        return prisma.$transaction(async tx => {
            // As an entry recorded: the company's switch can't go off meanwhile.
            await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR KEY SHARE`
            await inUse(companyId, tx)
            await CashAdvanceService.lockPerson(tx, person.id)
            const moved = await movedToRunning(tx, companyId, person.id, part, "BY_HAND", { id: session.user.id, name: session.user.name, role: session.user.role })
            if (!moved) throw new Error("CASH_ADVANCE_NOTHING_HELD")
            return { moved, balance: await balanceOf(tx, companyId, person.id) }
        })
    }

    /** What one person holds, which keeps them from being deleted for good (§7.4). */
    static async heldBy(companyId: string, userId: string, db: Db = prisma): Promise<number> {
        return balanceOf(db, companyId, userId)
    }

    /**
     * Holds one person's advance until the transaction ends: each entry is
     * recorded under it, and deleting the person for good takes it too, so
     * what they hold is what's seen.
     */
    static async lockPerson(tx: Prisma.TransactionClient, userId: string) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cash-advance:${userId}`}, 0))::text`
    }

    /** What a company's people hold between them: what the switches' card shows (§7.6). */
    static async heldIn(companyId: string, db: Db = prisma): Promise<number> {
        const sum = await db.cashAdvanceEntry.aggregate({ where: { companyId }, _sum: { amount: true } })
        return cents(Number(sum._sum.amount ?? 0))
    }

    /**
     * Refuses to switch cash advances off while anyone holds advance money
     * (§7.6). Holds the company, so no advance is recorded meanwhile: each
     * holds it too, first (record).
     */
    static async assertNoneHeld(tx: Prisma.TransactionClient, companyId: string) {
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`
        if (await CashAdvanceService.heldIn(companyId, tx) > 0) throw new Error("CASH_ADVANCES_HELD")
    }
}
