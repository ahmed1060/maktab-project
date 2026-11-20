import { prisma } from "@/lib/prisma"
import { can, type Actor } from "@/lib/permissions/can"
import { accountantReach, contractEnded, ENDED_STATUSES, type AccountantCandidate, type ClientAccountant } from "@/lib/client-accountant"

/**
 * A client's responsible accountant (CLIENT_PORTAL_PLAN.md §7, §12 step 9b;
 * PR 343): who may be picked, picking one, and reading who it is.
 *
 * Picked by whoever may manage clients, from the client's own company's
 * people whose contracts haven't ended. Whose contract ends later stays
 * picked: the client's page says the client's people can't write to them
 * until another is.
 */

const nameOf = (person: { firstName: string; lastName: string }) => `${person.firstName} ${person.lastName}`.trim()

/** The client asked about: by whoever may manage clients, in the client's own company. */
async function clientOf(user: Actor, clientId: unknown) {
    if (!can(user, "clients.manage")) throw new Error("CLIENTS_MANAGE_REQUIRED")
    if (typeof clientId !== "string" || !clientId) throw new Error("ACCOUNTANT_CLIENT_REQUIRED")
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, companyId: true } })
    if (!client || (user.role !== "SUPER_ADMIN" && client.companyId !== user.companyId)) throw new Error("CLIENT_NOT_FOUND")
    return client
}

/** Who a client's people write to, or why they can't write to anyone. */
export async function accountantOf(clientId: string): Promise<ClientAccountant> {
    const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: { responsibleAccountant: { select: { id: true, firstName: true, lastName: true, role: true, whatsappNumber: true, status: true } } },
    })
    const held = client?.responsibleAccountant
    const person = held
        ? { id: held.id, name: nameOf(held), role: held.role, whatsappNumber: held.whatsappNumber, ended: contractEnded(held.status) }
        : null
    return { person, reach: accountantReach(person) }
}

/** The client's company's people who may be picked: those whose contracts haven't ended, by name. */
export async function accountantCandidates(user: Actor, clientId: unknown): Promise<{ people: AccountantCandidate[] }> {
    const client = await clientOf(user, clientId)
    const people = await prisma.user.findMany({
        where: { companyId: client.companyId, role: { not: "SUPER_ADMIN" }, status: { notIn: [...ENDED_STATUSES] } },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
    })
    return { people: people.map(p => ({ id: p.id, name: nameOf(p) })) }
}

/**
 * Picks a client's responsible accountant, or no one (`userId: null`), and
 * says who the client's people can write to now. A pick that's who's kept
 * already writes nothing.
 *
 * The client is held first, then the person (lock order: a client before
 * what's its), so a pick and the client's archiving, or two picks, don't
 * cross.
 */
export async function setClientAccountant(user: Actor, body: unknown): Promise<ClientAccountant> {
    const { clientId, userId } = (body && typeof body === "object" ? body : {}) as { clientId?: unknown; userId?: unknown }
    const client = await clientOf(user, clientId)
    if (userId !== null && (typeof userId !== "string" || !userId)) throw new Error("ACCOUNTANT_PERSON_INVALID")

    const superAdmin = user.role === "SUPER_ADMIN"
    const { AuditLogService } = await import("./audit-log.service")
    await prisma.$transaction(async tx => {
        const held = await tx.$queryRaw<{ name: string; archivedAt: Date | null; responsibleAccountantId: string | null }[]>`
            SELECT name, "archivedAt", "responsibleAccountantId" FROM "Client" WHERE id = ${client.id} FOR UPDATE`
        if (!held[0]) throw new Error("CLIENT_NOT_FOUND")
        if (held[0].archivedAt) throw new Error("CLIENT_ARCHIVED")

        let to: string | null = null
        if (userId) {
            const picked = await tx.$queryRaw<{ firstName: string; lastName: string; companyId: string | null; role: string; status: string }[]>`
                SELECT "firstName", "lastName", "companyId", role::text AS role, status::text AS status FROM "User" WHERE id = ${userId} FOR SHARE`
            const person = picked[0]
            if (!person || person.companyId !== client.companyId || person.role === "SUPER_ADMIN") throw new Error("ACCOUNTANT_NOT_IN_COMPANY")
            if (contractEnded(person.status)) throw new Error("ACCOUNTANT_CONTRACT_ENDED")
            to = nameOf(person)
        }
        const was = held[0].responsibleAccountantId
        if (was === (userId ?? null)) return

        const before = was
            ? await tx.user.findUnique({ where: { id: was }, select: { firstName: true, lastName: true } })
            : null
        await tx.client.update({ where: { id: client.id }, data: { responsibleAccountantId: (userId as string | null) ?? null } })
        await AuditLogService.log("SET_CLIENT_ACCOUNTANT", "VENDOR", client.id, {
            tx,
            userId: superAdmin ? null : user.id,
            superAdminId: superAdmin ? user.id : null,
            details: { name: held[0].name, accountant: { from: before ? nameOf(before) : null, to } },
        })
    }, { maxWait: 10_000, timeout: 20_000 })
    return accountantOf(client.id)
}

/**
 * The clients a person is the responsible accountant for, by name, for their
 * profile's Contacting clients card. An archived client isn't among them.
 */
export async function clientsAnsweredFor(userId: string): Promise<string[]> {
    const clients = await prisma.client.findMany({
        where: { responsibleAccountantId: userId, archivedAt: null },
        select: { name: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
    })
    return clients.map(c => c.name)
}
