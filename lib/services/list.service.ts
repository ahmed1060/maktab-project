import { Prisma, type ListKind } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions/can"
import type { Permission } from "@/lib/permissions/catalogue"
import { LIST_KINDS, LIST_NAME_LIMITS, listName, sameListName } from "@/lib/saved-lists"

/**
 * A company's saved lists of cost names and task titles (CLIENTS_PLAN.md §5).
 *
 * Anyone in the company is offered the names as they type a title or a
 * cost's name; lists.add adds one, as "+ Add" does, and only that adds one;
 * lists.manage renames, merges and archives them. A name is in a list once,
 * ignoring capitals, archived ones too. Another company's name is "not
 * found", never "not allowed".
 */

type Session = { user: { id: string; role: string; companyId?: string | null; [key: string]: unknown } }
type Tx = Prisma.TransactionClient

const isSuperAdmin = (session: Session) => session.user.role === "SUPER_ADMIN"

/** The company asked about: a Super Admin's chosen one, or the person's own. */
function companyOf(session: Session, companyId?: string | null): string {
    if (!isSuperAdmin(session)) {
        if (!session.user.companyId) throw new Error("LIST_NAME_FORBIDDEN")
        return session.user.companyId
    }
    if (!companyId) throw new Error("COMPANY_SELECTION_REQUIRED")
    return companyId
}

function allow(session: Session, permission: Permission, companyId: string) {
    if (!can(session.user as any, permission, { companyId })) throw new Error("LIST_NAME_FORBIDDEN")
}

function kindOf(kind: unknown): ListKind {
    if (!LIST_KINDS.includes(kind as ListKind)) throw new Error("LIST_KIND_INVALID")
    return kind as ListKind
}

function audit(session: Session) {
    const sa = isSuperAdmin(session)
    return { userId: sa ? null : session.user.id, superAdminId: sa ? session.user.id : null }
}

const likeText = (text: string) => text.replace(/[\\%_]/g, c => `\\${c}`)

/** How many a picker is offered as someone types (DESIGN.md §5.3). */
export const SUGGESTION_LIMIT = 8

export type ListName = { id: string; name: string }
export type ManagedName = ListName & { archived: boolean; uses: number }

/** One of the company's names, held while it changes, or "not found". */
async function held(tx: Tx, session: Session, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("LIST_NAME_NOT_FOUND")
    const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ListEntry" WHERE id = ${id} FOR UPDATE`
    const entry = row && await tx.listEntry.findUnique({ where: { id } })
    if (!entry || (!isSuperAdmin(session) && entry.companyId !== session.user.companyId)) throw new Error("LIST_NAME_NOT_FOUND")
    return entry
}

/** Whether another name in that list is this one, ignoring capitals. */
async function sameName(tx: Tx, companyId: string, kind: ListKind, name: string, except?: string) {
    const [row] = await tx.$queryRaw<{ id: string; archivedAt: Date | null }[]>`
        SELECT id, "archivedAt" FROM "ListEntry"
        WHERE "companyId" = ${companyId} AND kind = ${kind}::"ListKind" AND lower(name) = lower(${name}) AND id <> ${except ?? ""}`
    return row
}

export class ListService {
    /**
     * What a picker suggests (DESIGN.md §5.3): the names in use that contain
     * what's typed, ignoring capitals, those starting with it first.
     */
    static async suggest(session: Session, input: { kind: unknown; q?: string | null; companyId?: string | null }): Promise<ListName[]> {
        const kind = kindOf(input.kind)
        const companyId = companyOf(session, input.companyId)
        const q = (input.q ?? "").trim()
        if (!q) return []
        const pattern = `%${likeText(q)}%`
        return prisma.$queryRaw<ListName[]>`
            SELECT id, name FROM "ListEntry"
            WHERE "companyId" = ${companyId} AND kind = ${kind}::"ListKind" AND "archivedAt" IS NULL AND name ILIKE ${pattern}
            ORDER BY (lower(name) LIKE lower(${`${likeText(q)}%`})) DESC, lower(name), id
            LIMIT ${SUGGESTION_LIMIT}`
    }

    /** A list as its page shows it: every name, archived ones too, with how often each is used. */
    static async list(session: Session, input: { kind: unknown; companyId?: string | null }): Promise<ManagedName[]> {
        const kind = kindOf(input.kind)
        const companyId = companyOf(session, input.companyId)
        allow(session, "lists.manage", companyId)
        const rows = await prisma.listEntry.findMany({
            where: { companyId, kind },
            select: { id: true, name: true, archivedAt: true, _count: { select: { tasks: true, costs: true } } },
            orderBy: [{ name: "asc" }, { id: "asc" }],
        })
        return rows.map(r => ({ id: r.id, name: r.name, archived: r.archivedAt !== null, uses: r._count.tasks + r._count.costs }))
    }

    /**
     * "+ Add" (§5.2–5.3). A name already there, ignoring capitals, is the
     * one given back, as two people may add it at once; an archived one is
     * refused, as an Admin took it out of use.
     */
    static async add(session: Session, input: { kind: unknown; name: unknown; companyId?: string | null }): Promise<ListName> {
        const kind = kindOf(input.kind)
        const companyId = companyOf(session, input.companyId)
        allow(session, "lists.add", companyId)
        const name = listName(kind, input.name)
        return prisma.$transaction(async tx => {
            if (isSuperAdmin(session) && !await tx.company.findUnique({ where: { id: companyId }, select: { id: true } })) throw new Error("COMPANY_NOT_FOUND")
            // Two adding the same name at once: the second waits and finds the first's.
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`list:${companyId}:${kind}:${name.toLowerCase()}`}))::text`
            const there = await sameName(tx, companyId, kind, name)
            if (there?.archivedAt) throw new Error("LIST_NAME_ARCHIVED")
            if (there) return tx.listEntry.findUniqueOrThrow({ where: { id: there.id }, select: { id: true, name: true } })
            const added = await tx.listEntry.create({
                data: { companyId, kind, name, createdById: isSuperAdmin(session) ? null : session.user.id },
                select: { id: true, name: true },
            })
            await tx.auditLog.create({ data: { action: "ADD_LIST_NAME", entityType: "LIST_ENTRY", entityId: added.id, ...audit(session), details: { kind, name } } })
            return added
        })
    }

    /** Renames a name. What was already written keeps its text (§5.5). */
    static async rename(session: Session, input: { id: unknown; name: unknown }): Promise<ListName> {
        return prisma.$transaction(async tx => {
            const entry = await held(tx, session, input.id)
            allow(session, "lists.manage", entry.companyId)
            const name = listName(entry.kind, input.name)
            if (name === entry.name) return { id: entry.id, name }
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`list:${entry.companyId}:${entry.kind}:${name.toLowerCase()}`}))::text`
            if (await sameName(tx, entry.companyId, entry.kind, name, entry.id)) throw new Error("LIST_NAME_TAKEN")
            const renamed = await tx.listEntry.update({ where: { id: entry.id }, data: { name }, select: { id: true, name: true } })
            await tx.auditLog.create({ data: { action: "RENAME_LIST_NAME", entityType: "LIST_ENTRY", entityId: entry.id, ...audit(session), details: { name: { old: entry.name, new: name } } } })
            return renamed
        })
    }

    /**
     * Merges a name into another of the same list, such as "transport" into
     * "Transport" (§5.6): what was picked as the one is the other's now, and
     * the one goes. The text written stays as it was.
     */
    static async merge(session: Session, input: { id: unknown; into: unknown }): Promise<ListName> {
        if (input.id === input.into) throw new Error("LIST_MERGE_SELF")
        return prisma.$transaction(async tx => {
            // Both held, in one order, so two merges of the pair can't deadlock.
            const [first, second] = [input.id, input.into].map(String).sort()
            await tx.$queryRaw`SELECT id FROM "ListEntry" WHERE id IN (${first}, ${second}) ORDER BY id FOR UPDATE`
            const from = await held(tx, session, input.id)
            const into = await held(tx, session, input.into)
            if (from.companyId !== into.companyId || from.kind !== into.kind) throw new Error("LIST_NAME_NOT_FOUND")
            allow(session, "lists.manage", from.companyId)
            const tasks = await tx.task.updateMany({ where: { titleEntryId: from.id }, data: { titleEntryId: into.id } })
            const costs = await tx.taskCost.updateMany({ where: { nameEntryId: from.id }, data: { nameEntryId: into.id } })
            await tx.listEntry.delete({ where: { id: from.id } })
            await tx.auditLog.create({ data: { action: "MERGE_LIST_NAMES", entityType: "LIST_ENTRY", entityId: into.id, ...audit(session), details: { name: from.name, into: into.name, uses: tasks.count + costs.count } } })
            return { id: into.id, name: into.name }
        })
    }

    /** Archives a name, or restores it: archived, it isn't offered, and keeps what was picked as it. */
    static async setArchived(session: Session, input: { id: unknown; archived: boolean }): Promise<ListName & { archived: boolean }> {
        return prisma.$transaction(async tx => {
            const entry = await held(tx, session, input.id)
            allow(session, "lists.manage", entry.companyId)
            if ((entry.archivedAt !== null) === input.archived) return { id: entry.id, name: entry.name, archived: input.archived }
            await tx.listEntry.update({ where: { id: entry.id }, data: { archivedAt: input.archived ? new Date() : null } })
            await tx.auditLog.create({ data: { action: input.archived ? "ARCHIVE_LIST_NAME" : "RESTORE_LIST_NAME", entityType: "LIST_ENTRY", entityId: entry.id, ...audit(session), details: { name: entry.name } } })
            return { id: entry.id, name: entry.name, archived: input.archived }
        })
    }

    /**
     * The name a title or a cost's name was picked as (§5.5), checked: the
     * task's company's, from that list, and in use, unless it's the one the
     * item already has (archived since). Kept only while the text is that
     * name, ignoring capitals: one typed again since, or renamed meanwhile,
     * is saved as typed, with no name picked. None stays none.
     */
    static async picked(db: Tx | typeof prisma, entryId: unknown, text: string | null | undefined, at: { companyId: string | null; kind: ListKind; current?: string | null }): Promise<string | null> {
        if (entryId === undefined || entryId === null || entryId === "" || !text) return null
        if (typeof entryId !== "string") throw new Error("LIST_NAME_NOT_FOUND")
        const entry = await db.listEntry.findUnique({ where: { id: entryId }, select: { companyId: true, kind: true, name: true, archivedAt: true } })
        if (!entry || entry.companyId !== at.companyId || entry.kind !== at.kind) throw new Error("LIST_NAME_NOT_FOUND")
        if (entry.archivedAt && entryId !== at.current) throw new Error("LIST_NAME_ARCHIVED")
        return sameListName(entry.name, text) ? entryId : null
    }
}

export { LIST_NAME_LIMITS }
