import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { can, type Actor } from "@/lib/permissions/can"
import { clientAccountHasEmail, isEmailClash, personHasEmail } from "@/lib/account-email"
import { MAX_CLIENT_PEOPLE, NIZMO_ID, sentPerson, type ClientLanguage, type ClientPeople, type ClientPerson } from "@/lib/client-accounts"
import { invitationLink, justSent, newInvitation } from "@/lib/client-invitation"
import { invitationEmail } from "@/lib/client-invitation-email"
import { PRODUCTION_ORIGIN } from "@/lib/app-origin"
import { sendOfficeEmail } from "@/lib/email"
import { defaultBrandColour } from "@/lib/page-brand-colour"

/**
 * A client's people who sign in to the client portal (CLIENT_PORTAL_PLAN.md
 * §5.1, §5.2; PR 322): listing them, adding one and removing one, for
 * whoever may manage them. They're never the company's own people, so
 * nothing here reads or writes a User.
 *
 * Added, a person is invited, with a link that works once, for 72 hours,
 * which sets their password (step 6b-1, PR 324). The link is emailed to
 * them in the language they're invited in, and can be sent again, which
 * makes a new one (step 6b-2, PR 325).
 */

/** Who's asking, with the name kept beside who they added. */
type Adder = Actor & { name?: string | null }

/** What's given of an account. Never its password. */
const GIVEN = { id: true, name: true, email: true, invitedAt: true, activatedAt: true, lastSignInAt: true, language: true } as const
type GivenRow = { id: string; name: string; email: string; invitedAt: Date; activatedAt: Date | null; lastSignInAt: Date | null; language: string }

/** A language as it's kept: Arabic or English, which the database holds it to. */
const languageOf = (kept: string): ClientLanguage => (kept === "en" ? "en" : "ar")

const personOf = (row: GivenRow): ClientPerson => ({
    id: row.id,
    name: row.name,
    email: row.email,
    state: row.activatedAt ? "active" : "invited",
    invitedAt: row.invitedAt.toISOString(),
    lastSignInAt: row.lastSignInAt ? row.lastSignInAt.toISOString() : null,
    language: languageOf(row.language),
})

/**
 * The client whose people are asked about: by whoever may manage them, in
 * the client's own company, so another company's reads as not there
 * whatever the address says. The Super Admin manages any company's.
 */
async function clientOf(user: Actor, clientId: string | null | undefined) {
    if (!can(user, "client_accounts.manage")) throw new Error("CLIENT_ACCOUNTS_MANAGE_REQUIRED")
    if (!clientId) throw new Error("CLIENT_PERSON_CLIENT_REQUIRED")
    const client = NIZMO_ID.test(clientId) ? await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, companyId: true, archivedAt: true, company: { select: { name: true } } } }) : null
    if (!client || (user.role !== "SUPER_ADMIN" && client.companyId !== user.companyId)) throw new Error("CLIENT_NOT_FOUND")
    return client
}

/**
 * Whoever in the office sends an invitation, for its reply and the line to
 * ask them (§5.2): their name and the email their account has now. A Super
 * Admin isn't one of the office's people, so none.
 */
async function senderOf(user: Actor): Promise<{ name: string; email: string } | null> {
    if (user.role === "SUPER_ADMIN" || !user.id) return null
    const person = await prisma.user.findUnique({ where: { id: user.id }, select: { firstName: true, lastName: true, email: true } })
    return person ? { name: `${person.firstName} ${person.lastName}`.trim(), email: person.email } : null
}

type Invitation = {
    to: { name: string; email: string }
    language: ClientLanguage
    office: string
    client: string
    sender: { name: string; email: string } | null
    token: string
    origin: string
    resent: boolean
    brand: string | null
}

/**
 * Emails the invitation's link (§5.2; PR 325), once the save that made it is
 * made: the link it carries is one the database keeps, however long sending
 * takes. Sent inside the save, an email slower than the save's time limit
 * went out with a link the save, rolled back, never kept (found by Codex on
 * PR 325). One that can't be sent throws, and the save is taken back (see
 * takeBack). An address kept for examples is never emailed (lib/email.ts),
 * and the save stands.
 */
async function sendInvitation(invitation: Invitation): Promise<void> {
    const origin = invitation.origin.replace(/\/+$/, "")
    const email = invitationEmail({
        language: invitation.language,
        person: invitation.to,
        office: invitation.office,
        client: invitation.client,
        sender: invitation.sender,
        link: invitationLink(origin, invitation.token),
        privacy: `${origin}/privacy`,
        resent: invitation.resent,
        brand: invitation.brand,
    })
    await sendOfficeEmail({
        to: { name: invitation.to.name, address: invitation.to.email },
        fromName: email.fromName,
        replyTo: email.replyTo,
        subject: email.subject,
        text: email.text,
        html: email.html,
    })
}

/**
 * Takes back a save whose email couldn't be sent, so the office is told the
 * truth: try again. Only what the save itself made: `undo` matches on the
 * link it made, so a link used meanwhile, or replaced, is left alone. The
 * email's own failure is what's answered; one that can't be taken back as
 * well is logged.
 */
async function takeBack(undo: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
    try {
        await prisma.$transaction(undo)
    } catch (error) {
        console.error("[client accounts] an invitation that couldn't be sent couldn't be taken back either", error)
    }
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
 * Adds one of a client's people, as invited (§5.2), and emails them their
 * invitation, in the language they're invited in, from the office, with a
 * reply to whoever added them. Nothing sent is trusted: the name, email and
 * language are read by lib/client-accounts.ts's rules. The link is to
 * `origin`, Nizmo's own address (lib/app-origin.ts).
 *
 * Refused for an archived client, whose people can't sign in (§5.3); for a
 * client with as many people as one can have; and for an email someone has
 * already, one of the company's people, a Super Admin or anyone's client
 * account, capitals aside (§5.1).
 */
export async function addClientPerson(user: Adder, body: unknown, now: Date = new Date(), origin: string = PRODUCTION_ORIGIN): Promise<ClientPerson> {
    if (!can(user, "client_accounts.manage")) throw new Error("CLIENT_ACCOUNTS_MANAGE_REQUIRED")
    const sent = sentPerson(body)
    if ("problem" in sent) {
        throw new Error({ client: "CLIENT_PERSON_CLIENT_REQUIRED", name: "CLIENT_PERSON_NAME_REQUIRED", name_long: "CLIENT_PERSON_NAME_TOO_LONG", email: "CLIENT_PERSON_EMAIL_INVALID", language: "CLIENT_PERSON_LANGUAGE_INVALID" }[sent.problem])
    }
    const { person } = sent
    const client = await clientOf(user, person.clientId)
    if (client.archivedAt) throw new Error("CLIENT_ARCHIVED")
    // Read before anything is held: who sends it, and the colour it's drawn in.
    const sender = await senderOf(user)
    const brand = await defaultBrandColour()

    const superAdmin = user.role === "SUPER_ADMIN"
    const { AuditLogService } = await import("./audit-log.service")
    // Their invitation's link, kept only as its hash. Its secret goes out
    // in the invitation's email, and nowhere else.
    const link = newInvitation(now)
    const saved = await prisma.$transaction(async tx => {
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
        const added = await tx.clientAccount.create({
            data: {
                companyId: client.companyId,
                clientId: client.id,
                name: person.name,
                email: person.email,
                language: person.language,
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

        const logged = await AuditLogService.log("ADD_CLIENT_ACCOUNT", "VENDOR", client.id, {
            tx,
            userId: superAdmin ? null : user.id,
            superAdminId: superAdmin ? user.id : null,
            details: { name: held[0].name, person: added.name, email: added.email },
        })
        return { added, clientName: held[0].name, auditId: logged.id }
    }, { maxWait: 10_000, timeout: 20_000 })

    const { added } = saved
    try {
        await sendInvitation({
            to: { name: added.name, email: added.email },
            language: person.language,
            office: client.company.name,
            client: saved.clientName,
            sender,
            token: link.token,
            origin,
            resent: false,
            brand,
        })
    } catch (error) {
        // Not sent: the person isn't added after all, nor written down as added.
        await takeBack(async tx => {
            const gone = await tx.clientAccount.deleteMany({ where: { id: added.id, inviteTokenHash: link.tokenHash } })
            if (gone.count) await tx.auditLog.deleteMany({ where: { id: saved.auditId } })
        })
        throw error
    }
    return personOf(added)
}

/**
 * Sends one of a client's people their invitation again (§5.2; PR 325): a
 * new link, which works once, for 72 hours, and the earlier one stops
 * working. In the language their account keeps, from the office, with a
 * reply to whoever sent it again. For someone still invited: once their
 * password is set they sign in, or use Forgot password. Another company's
 * reads as not there.
 *
 * Held as setting the password holds it: the client first, then the
 * account, in the order deleting a client holds them, so a client archived
 * meanwhile is refused, and the link is replaced once at a time. Sent once
 * the new link is saved; one that can't be sent puts the earlier link back.
 */
export async function resendClientInvitation(user: Actor, id: string | null | undefined, now: Date = new Date(), origin: string = PRODUCTION_ORIGIN): Promise<{ resent: true }> {
    if (!can(user, "client_accounts.manage")) throw new Error("CLIENT_ACCOUNTS_MANAGE_REQUIRED")
    const account = id && NIZMO_ID.test(id)
        ? await prisma.clientAccount.findUnique({ where: { id }, select: { id: true, clientId: true, companyId: true, company: { select: { name: true } } } })
        : null
    if (!account || (user.role !== "SUPER_ADMIN" && account.companyId !== user.companyId)) throw new Error("CLIENT_PERSON_NOT_FOUND")
    const sender = await senderOf(user)
    const brand = await defaultBrandColour()

    const superAdmin = user.role === "SUPER_ADMIN"
    const { AuditLogService } = await import("./audit-log.service")
    const link = newInvitation(now)
    const saved = await prisma.$transaction(async tx => {
        // One query after another: a transaction has one connection.
        const client = await tx.$queryRaw<{ name: string; archivedAt: Date | null }[]>`SELECT name, "archivedAt" FROM "Client" WHERE id = ${account.clientId} FOR SHARE`
        if (!client.length) throw new Error("CLIENT_PERSON_NOT_FOUND")
        if (client[0].archivedAt) throw new Error("CLIENT_ARCHIVED")
        const held = await tx.$queryRaw<{ name: string; email: string; language: string; activatedAt: Date | null; inviteTokenHash: string | null; inviteExpiresAt: Date | null }[]>`SELECT name, email, language, "activatedAt", "inviteTokenHash", "inviteExpiresAt" FROM "ClientAccount" WHERE id = ${account.id} FOR UPDATE`
        // Removed by somebody else a moment before.
        if (!held.length) throw new Error("CLIENT_PERSON_NOT_FOUND")
        if (held[0].activatedAt) throw new Error("CLIENT_PERSON_ACTIVE")
        // One at a time: the email before may still be on its way, and two
        // at once that both fail could put back a link neither sent (found
        // by Codex on PR 325).
        if (held[0].inviteExpiresAt && justSent(held[0].inviteExpiresAt, now)) throw new Error("CLIENT_INVITATION_JUST_SENT")

        await tx.clientAccount.update({ where: { id: account.id }, data: { inviteTokenHash: link.tokenHash, inviteExpiresAt: link.expiresAt } })
        const logged = await AuditLogService.log("RESEND_CLIENT_INVITATION", "VENDOR", account.clientId, {
            tx,
            userId: superAdmin ? null : user.id,
            superAdminId: superAdmin ? user.id : null,
            details: { name: client[0].name, person: held[0].name, email: held[0].email },
        })
        return { person: held[0], clientName: client[0].name, auditId: logged.id }
    }, { maxWait: 10_000, timeout: 20_000 })

    const { person } = saved
    try {
        await sendInvitation({
            to: { name: person.name, email: person.email },
            language: languageOf(person.language),
            office: account.company.name,
            client: saved.clientName,
            sender,
            token: link.token,
            origin,
            resent: true,
            brand,
        })
    } catch (error) {
        // Not sent: the earlier link works again, and nothing is written down as sent.
        await takeBack(async tx => {
            const restored = await tx.clientAccount.updateMany({
                where: { id: account.id, inviteTokenHash: link.tokenHash },
                data: { inviteTokenHash: person.inviteTokenHash, inviteExpiresAt: person.inviteExpiresAt },
            })
            if (restored.count) await tx.auditLog.deleteMany({ where: { id: saved.auditId } })
        })
        throw error
    }
    return { resent: true }
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
