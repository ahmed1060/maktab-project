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
import {
    CASH_ADVANCE_NOTE_MAX, HANDOVER_FOLDER, RECORDED_KINDS, balanceAfter, cashAdvancesInUse, dayOf, signedAmount, type RecordedKind,
} from "@/lib/cash-advances"

/**
 * Cash advances (CLIENTS_PLAN.md §7): money a company gives an employee up
 * front, to pay task costs from. Every movement is an entry, never edited,
 * and a balance is always the sum of its person's entries (§7.4).
 */

/** Whose contract has ended: they hold no advance money, so what comes back to them is a debt (§7.3). */
const GONE = "ARCHIVED"

/** A debt's source when it's what someone still held on leaving (§7.3). */
export const CASH_ADVANCE_DEBT = "CASH_ADVANCE"

/** At work: not suspended, deleted or gone, so an advance may be given (§7.4). */
const AT_WORK = ["ACTIVE", "OFFLINE"] as const

type Db = Prisma.TransactionClient | typeof prisma

/** The Cash advances tab's filters (§7.5, §7.8). */
export type CashAdvanceFilters = {
    /** A Super Admin's chosen company: they pick one first. */
    companyId?: string
    search?: string
    /** Only those holding an advance. */
    holding?: boolean
}

/** What a person records (§7.3, §7.4), as sent. */
export type CashAdvanceInput = { kind?: unknown; amount?: unknown; date?: unknown; note?: unknown; photoUrl?: unknown }

const PERSON = { id: true, firstName: true, lastName: true, status: true, companyId: true, teamLeaderId: true, role: true } satisfies Prisma.UserSelect

const ENTRY = {
    id: true, kind: true, amount: true, date: true, note: true, photoUrl: true, confirmedAt: true, recordedByName: true, createdAt: true,
    // A Spent one's task, while it's there (§7.4).
    task: { select: { id: true, title: true } },
} satisfies Prisma.CashAdvanceEntrySelect

function nameOf(person: { firstName: string; lastName: string }) {
    return `${person.firstName} ${person.lastName}`.trim()
}

function entryOf(entry: Prisma.CashAdvanceEntryGetPayload<{ select: typeof ENTRY }>) {
    return { ...entry, amount: Number(entry.amount), date: entry.date.toISOString().slice(0, 10) }
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

/**
 * Each person's balance in a company, what of it is awaiting their
 * confirmation, and the day of their last movement: those with entries only.
 */
async function balancesIn(companyId: string) {
    const [sums, awaiting] = await Promise.all([
        prisma.cashAdvanceEntry.groupBy({ by: ["userId"], where: { companyId }, _sum: { amount: true }, _max: { date: true } }),
        prisma.cashAdvanceEntry.groupBy({ by: ["userId"], where: { companyId, kind: "GIVEN", confirmedAt: null }, _sum: { amount: true } }),
    ])
    const waiting = new Map(awaiting.map(a => [a.userId, cents(Number(a._sum.amount ?? 0))]))
    return new Map(sums.map(s => [s.userId, {
        balance: cents(Number(s._sum.amount ?? 0)),
        awaiting: waiting.get(s.userId) ?? 0,
        lastDate: s._max.date ? s._max.date.toISOString().slice(0, 10) : null,
    }]))
}

/**
 * Today, where the company is: the last day an entry may be recorded on.
 * Inside a transaction, read through it: one waiting for a connection the
 * others hold, while they wait on its hold on an advance, never gets one.
 */
async function todayIn(companyId: string, db: Db = prisma): Promise<string> {
    return calendarDateStr(new Date(), await filterTimeZone(companyId, db))
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
        const of = (id: string) => balances.get(id) ?? { balance: 0, awaiting: 0, lastDate: null }
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
        const [entries, total, balance, awaiting] = await Promise.all([
            prisma.cashAdvanceEntry.findMany({ where, select: ENTRY, orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }], skip: paging.skip, take: paging.limit }),
            prisma.cashAdvanceEntry.count({ where }),
            balanceOf(prisma, person.companyId, person.id),
            prisma.cashAdvanceEntry.aggregate({ where: { ...where, kind: "GIVEN", confirmedAt: null }, _sum: { amount: true } }),
        ])
        return {
            today: await todayIn(person.companyId),
            person: { id: person.id, name: nameOf(person), atWork: (AT_WORK as readonly string[]).includes(person.status) },
            balance,
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
                const before = await balanceOf(tx, companyId, person.id)
                const after = balanceAfter(before, amount)
                if (after === null) throw new Error(kind === "RETURNED" ? "CASH_ADVANCE_MORE_THAN_HELD" : "CASH_ADVANCE_BELOW_ZERO")
                const entry = await tx.cashAdvanceEntry.create({
                    data: {
                        companyId, userId: person.id, kind, amount, date: new Date(`${date}T00:00:00Z`), note, photoUrl,
                        recordedById: session.user.id, recordedByName: session.user.name ?? null,
                    },
                    select: ENTRY,
                })
                await tx.auditLog.create({
                    data: {
                        action: { GIVEN: "GIVE_CASH_ADVANCE", RETURNED: "RETURN_CASH_ADVANCE", CORRECTION: "CORRECT_CASH_ADVANCE" }[kind],
                        entityType: "USER", entityId: person.id,
                        userId: superAdmin ? null : session.user.id, superAdminId: superAdmin ? session.user.id : null,
                        details: { entryId: entry.id, amount, date, balance: after, ...(note && { note }) },
                    },
                })
                // Someone whose contract has ended holds nothing: a correction
                // finding they held more makes it a debt, as at their leaving (§7.3).
                if (now.status === GONE && after > 0) {
                    await CashAdvanceService.toDebt(tx, companyId, person.id, null, { dueDate: new Date(), by: { id: session.user.id, name: session.user.name } })
                    return { entry: entryOf(entry), balance: 0 }
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
     * company person's: a Super Admin holds none. Each cost's part, which
     * spent() then records once the costs are there. Holds the company and
     * the person's advance, as recording an entry does.
     */
    static async spendFor(tx: Prisma.TransactionClient, author: { id: string; role?: string | null }, companyId: string | null, amounts: readonly number[]): Promise<number[]> {
        const none = amounts.map(() => 0)
        if (!companyId || author.role === "SUPER_ADMIN") return none
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR KEY SHARE`
        const company = await tx.company.findUnique({ where: { id: companyId }, select: { cashAdvancesAllowed: true, cashAdvancesOn: true } })
        if (!cashAdvancesInUse(company)) return none
        await CashAdvanceService.lockPerson(tx, author.id)
        let balance = await balanceOf(tx, companyId, author.id)
        return amounts.map(amount => {
            const part = cents(Math.min(balance, amount))
            balance = cents(balance - part)
            return part
        })
    }

    /**
     * Spent entries for costs paid from an advance (§7.4): taken off as they
     * were added (way -1), or put back as they're removed (way 1), each on
     * its cost and task. One put back is put back whether or not the company
     * still uses cash advances: the money is the person's again.
     */
    static async spent(tx: Prisma.TransactionClient, companyId: string, taskId: string, costs: readonly { id: string; authorId: string | null; part: number }[], way: -1 | 1, by: { id: string; name?: string | null }) {
        let parts = costs.filter((c): c is { id: string; authorId: string; part: number } => !!c.authorId && c.part > 0)
        if (!parts.length) return
        let gone: string[] = []
        if (way === 1) {
            // Each person's advance held, in one order, so two removals don't wait on each other.
            const authors = [...new Set(parts.map(c => c.authorId))].sort()
            for (const authorId of authors) await CashAdvanceService.lockPerson(tx, authorId)
            // Someone deleted for good since has no advance to put it back on:
            // theirs went with them, held at nothing (UserService.delete).
            const here = await tx.user.findMany({ where: { id: { in: authors } }, select: { id: true, status: true } })
            parts = parts.filter(c => here.some(u => u.id === c.authorId))
            if (!parts.length) return
            gone = here.filter(u => u.status === GONE).map(u => u.id)
        }
        const date = new Date(`${await todayIn(companyId, tx)}T00:00:00Z`)
        await tx.cashAdvanceEntry.createMany({
            data: parts.map(c => ({
                companyId, userId: c.authorId, kind: "SPENT" as const, amount: cents(way * c.part), date,
                costId: c.id, taskId, recordedById: by.id, recordedByName: by.name ?? null,
            })),
        })
        // Someone whose contract has ended holds nothing: what's put back on
        // theirs becomes a debt at once, as at their leaving (§7.3).
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
     */
    static async toDebt(
        tx: Prisma.TransactionClient,
        companyId: string,
        userId: string,
        counted: number | null,
        debt: { dueDate: Date; by: { id: string; name?: string | null } },
    ) {
        await CashAdvanceService.lockPerson(tx, userId)
        const held = await balanceOf(tx, companyId, userId)
        if (counted !== null && held !== cents(counted)) throw new Error("CASH_ADVANCE_CHANGED")
        if (held <= 0) return null
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
