import { prisma } from "@/lib/prisma"
import { can, type Actor } from "@/lib/permissions/can"
import { clientAccountHasEmail, isEmailClash, personHasEmail } from "@/lib/account-email"
import { MAX_CLIENT_PEOPLE, NIZMO_ID, sentPerson, type ClientPeople, type ClientPerson } from "@/lib/client-accounts"
import { newInvitation } from "@/lib/client-invitation"

/**
 * A client's people who sign in to the client portal (CLIENT_PORTAL_PLAN.md
 * §5.1, §5.2; PR 322): listing them, adding one and removing one, for
 * whoever may manage them. They're never the company's own people, so
 * nothing here reads or writes a User.
 *
 * Added, a person is invited, with a link that works once, for 72 hours,
 * which sets their password (step 6b-1, PR 324). Its email is step 6b-2.
 */

/** Who's asking, with the name kept beside who they added. */
type Adder = Actor & { name?: string | null }

/** What's given of an account. Never its password. */
const GIVEN = { id: true, name: true, email: true, invitedAt: true, activatedAt: true, lastSignInAt: true } as const
type GivenRow = { id: string; name: string; email: string; invitedAt: Date; activatedAt: Date | null; lastSignInAt: Date | null }

const personOf = (row: GivenRow): ClientPerson => ({
    id: row.id,
    name: row.name,
    email: row.email,
    state: row.activatedAt ? "active" : "invited",
    invitedAt: row.invitedAt.toISOString(),
    lastSignInAt: row.lastSignInAt ? row.lastSignInAt.toISOString() : null,
})

/**
 * The client whose people are asked about: by whoever may manage them, in
 * the client's own company, so another company's reads as not there
 * whatever the address says. The Super Admin manages any company's.
 */
async function clientOf(user: Actor, clientId: string | null | undefined) {
    if (!can(user, "client_accounts.manage")) throw new Error("CLIENT_ACCOUNTS_MANAGE_REQUIRED")
    if (!clientId) throw new Error("CLIENT_PERSON_CLIENT_REQUIRED")
    const client = NIZMO_ID.test(clientId) ? await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, companyId: true, archivedAt: true } }) : null
    if (!client || (user.role !== "SUPER_ADMIN" && client.companyId !== user.companyId)) throw new Error("CLIENT_NOT_FOUND")
    return client
}

/**
 * A client's people, in the order they were added: each by name and email,
 * whether they're invited or active, and when. An archived client's are
 * still listed, so they can be removed.
 */
export async function clientPeople(user: Actor, clientId: string | null | undefined): Promise<ClientPeople> {
    const client = await clientOf(user, clientId)
    const rows = await prisma.clientAccount.findMany({ where: { clientId: client.id }, select: GIVEN, orderBy: [{ invitedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }] })
    return { client: { id: client.id, name: client.name, archived: !!client.archivedAt }, max: MAX_CLIENT_PEOPLE, people: rows.map(personOf) }
}

/**
 * Adds one of a client's people, as invited (§5.2). Nothing sent is trusted:
 * the name and email are read by lib/client-accounts.ts's rules.
 *
 * Refused for an archived client, whose people can't sign in (§5.3); for a
 * client with as many people as one can have; and for an email someone has
 * already, one of the company's people, a Super Admin or anyone's client
 * account, capitals aside (§5.1).
 */
export async function addClientPerson(user: Adder, body: unknown, now: Date = new Date()): Promise<ClientPerson> {
    if (!can(user, "client_accounts.manage")) throw new Error("CLIENT_ACCOUNTS_MANAGE_REQUIRED")
    const sent = sentPerson(body)
    if ("problem" in sent) {
        throw new Error({ client: "CLIENT_PERSON_CLIENT_REQUIRED", name: "CLIENT_PERSON_NAME_REQUIRED", name_long: "CLIENT_PERSON_NAME_TOO_LONG", email: "CLIENT_PERSON_EMAIL_INVALID" }[sent.problem])
    }
    const { person } = sent
    const client = await clientOf(user, person.clientId)
    if (client.archivedAt) throw new Error("CLIENT_ARCHIVED")

    const superAdmin = user.role === "SUPER_ADMIN"
    const { AuditLogService } = await import("./audit-log.service")
    return prisma.$transaction(async tx => {
        // The client's row is held first, as archiving and deleting it hold
        // it: its people are counted and added one after the other, and a
        // client archived meanwhile is refused. One query after another from
        // here: a transaction has one connection.
        const held = await tx.$queryRaw<{ name: string; archivedAt: Date | null }[]>`SELECT name, "archivedAt" FROM "Client" WHERE id = ${client.id} FOR UPDATE`
        if (!held.length) throw new Error("CLIENT_NOT_FOUND")
        if (held[0].archivedAt) throw new Error("CLIENT_ARCHIVED")
        if (await tx.clientAccount.count({ where: { clientId: client.id } }) >= MAX_CLIENT_PEOPLE) throw new Error("CLIENT_PEOPLE_FULL")

        // Said before the save where it can be. The database holds the rule
        // itself, for an email given to somebody else at this very moment.
        if (await clientAccountHasEmail(person.email, tx) || await personHasEmail(person.email, tx)) throw new Error("CLIENT_PERSON_EMAIL_IN_USE")
        // Their invitation's link, kept only as its hash. Its secret goes out
        // in the invitation's email, from step 6b-2; until then nobody has it.
        const link = newInvitation(now)
        const added = await tx.clientAccount.create({
            data: {
                companyId: client.companyId,
                clientId: client.id,
                name: person.name,
                email: person.email,
                invitedAt: now,
                inviteTokenHash: link.tokenHash,
                inviteExpiresAt: link.expiresAt,
                // A Super Admin isn't one of the company's people: their name is kept, as anyone's is.
                addedById: superAdmin ? null : user.id ?? null,
                addedByName: user.name ?? null,
            },
            select: GIVEN,
        }).catch((error: unknown) => {
            if (isEmailClash(error)) throw new Error("CLIENT_PERSON_EMAIL_IN_USE")
            throw error
        })

        await AuditLogService.log("ADD_CLIENT_ACCOUNT", "VENDOR", client.id, {
            tx,
            userId: superAdmin ? null : user.id,
            superAdminId: superAdmin ? user.id : null,
            details: { name: held[0].name, person: added.name, email: added.email },
        })
        return personOf(added)
    }, { maxWait: 10_000, timeout: 20_000 })
}

/**
 * Removes one of a client's people (§5.2): their account goes, and with it
 * their sign-in. An archived client's can be removed too. Another company's
 * reads as not there.
 */
export async function removeClientPerson(user: Actor, id: string | null | undefined): Promise<{ removed: true }> {
    if (!can(user, "client_accounts.manage")) throw new Error("CLIENT_ACCOUNTS_MANAGE_REQUIRED")
    const account = id && NIZMO_ID.test(id)
        ? await prisma.clientAccount.findUnique({ where: { id }, select: { id: true, name: true, email: true, clientId: true, companyId: true, client: { select: { name: true } } } })
        : null
    if (!account || (user.role !== "SUPER_ADMIN" && account.companyId !== user.companyId)) throw new Error("CLIENT_PERSON_NOT_FOUND")

    const superAdmin = user.role === "SUPER_ADMIN"
    const { AuditLogService } = await import("./audit-log.service")
    await prisma.$transaction(async tx => {
        // Removed by somebody else a moment before: nothing to remove, and nothing to write down.
        const gone = await tx.clientAccount.deleteMany({ where: { id: account.id } })
        if (!gone.count) throw new Error("CLIENT_PERSON_NOT_FOUND")
        await AuditLogService.log("REMOVE_CLIENT_ACCOUNT", "VENDOR", account.clientId, {
            tx,
            userId: superAdmin ? null : user.id,
            superAdminId: superAdmin ? user.id : null,
            details: { name: account.client.name, person: account.name, email: account.email },
        })
    })
    return { removed: true }
}
