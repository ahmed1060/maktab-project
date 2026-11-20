import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { AuditLogService } from '@/lib/services/audit-log.service'
import { PACKAGE_FACTS } from '@/lib/services/company-package'
import { hasModule, resolveBundles } from '@/lib/features/bundles'
import {
    MESSAGE_KINDS, MESSAGE_LANGUAGES, NIZMO_MESSAGES, messageProblem, messagesFrom,
    type ClientMessages, type CompanyMessage, type MessageKind, type MessageLanguage, type NizmoMessage,
} from '@/lib/client-message-template'

export type { CompanyMessage, NizmoMessage }

/**
 * The messages a company's client's people are given (CLIENT_PORTAL_PLAN.md
 * §7.1, §12 step 10a; PR 346): each of the two, in each language, the
 * company's copy, else Nizmo's as the Super Admin changed it, else Nizmo's
 * own as written. Read with the client's page, on the server, from the
 * session's company.
 */
export async function clientMessages(companyId: string): Promise<ClientMessages> {
    const kept = await prisma.clientMessageTemplate.findMany({
        // A message the company put back to Nizmo's is Nizmo's (PR 348).
        where: { OR: [{ companyId, usesNizmo: false }, { companyId: null }] },
        select: { companyId: true, kind: true, language: true, text: true },
    })
    return messagesFrom(kept)
}

type Kept = { text: string; updatedByName: string | null; updatedAt: Date }

const shaped = (kind: MessageKind, language: MessageLanguage, row: Kept | null): NizmoMessage => row
    ? { kind, language, text: row.text, changedBy: row.updatedByName, changedAt: row.updatedAt.toISOString() }
    : { kind, language, text: NIZMO_MESSAGES[kind][language], changedBy: null, changedAt: null }

/** Each message in each language, Contact the accountant's first and Arabic before English. */
export async function nizmoMessages(): Promise<NizmoMessage[]> {
    const rows = await prisma.clientMessageTemplate.findMany({
        where: { companyId: null },
        select: { kind: true, language: true, text: true, updatedByName: true, updatedAt: true },
    })
    return MESSAGE_KINDS.flatMap(kind => MESSAGE_LANGUAGES.map(language =>
        shaped(kind, language, rows.find(r => r.kind === kind && r.language === language) ?? null)))
}

/** How the audit log names a message and a language: codes it has words for (audit_value_*). */
const AUDIT_MESSAGE: Record<MessageKind, string> = { contact: 'CONTACT_ACCOUNTANT', claim: 'ASK_ABOUT_CLAIM' }
const AUDIT_LANGUAGE: Record<MessageLanguage, string> = { ar: 'AR', en: 'EN' }

/**
 * The Super Admin changes one of Nizmo's messages, for every company without
 * a copy of its own. Refused, with nothing written, where the text doesn't
 * pass the checks (MESSAGE_EMPTY, MESSAGE_TOO_LONG, MESSAGE_FIELD), or where
 * it was changed since the page read it (MESSAGE_CHANGED_SINCE): `since` is
 * the time it said the message was last changed, none if never. A text the
 * same as it is writes nothing. Each change is in the audit log, with what
 * it was and what it is, by the Super Admin's name too.
 */
export async function saveNizmoMessage(
    by: { id: string; name: string },
    { kind, language, text, since }: { kind: MessageKind; language: MessageLanguage; text: string; since: string | null },
): Promise<NizmoMessage> {
    const kept = checked(kind, text)
    try {
        return await prisma.$transaction(async tx => {
            const row = await tx.clientMessageTemplate.findFirst({
                where: { companyId: null, kind, language },
                select: { id: true, text: true, updatedByName: true, updatedAt: true },
            })
            if ((row?.updatedAt.toISOString() ?? null) !== since) throw new Error('MESSAGE_CHANGED_SINCE')
            const before = row?.text ?? NIZMO_MESSAGES[kind][language]
            if (kept === before) return shaped(kind, language, row)
            let saved: Kept & { id: string }
            if (row) {
                // Only where it's still as it was read: a save that came first has moved its time on.
                const { count } = await tx.clientMessageTemplate.updateMany({
                    where: { id: row.id, updatedAt: row.updatedAt },
                    data: { text: kept, updatedById: null, updatedByName: by.name },
                })
                if (count === 0) throw new Error('MESSAGE_CHANGED_SINCE')
                saved = await tx.clientMessageTemplate.findUniqueOrThrow({ where: { id: row.id }, select: { id: true, text: true, updatedByName: true, updatedAt: true } })
            } else {
                saved = await tx.clientMessageTemplate.create({
                    data: { companyId: null, kind, language, text: kept, updatedByName: by.name },
                    select: { id: true, text: true, updatedByName: true, updatedAt: true },
                })
            }
            await AuditLogService.log('UPDATE_CLIENT_MESSAGE', 'CLIENT_MESSAGE', saved.id, {
                tx,
                superAdminId: by.id,
                details: { message: AUDIT_MESSAGE[kind], language: AUDIT_LANGUAGE[language], before, after: kept },
            })
            return shaped(kind, language, saved)
        })
    } catch (e) {
        // Another save kept the message first, its row the one there can be.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new Error('MESSAGE_CHANGED_SINCE')
        throw e
    }
}

/** A text as it's kept, its lines ended by a new line alone; refused where it doesn't pass the checks. */
function checked(kind: MessageKind, text: string): string {
    const kept = text.replace(/\r\n?/g, '\n')
    const problem = messageProblem(kind, kept)
    if (problem) throw new Error(problem.problem === 'empty' ? 'MESSAGE_EMPTY' : problem.problem === 'too_long' ? 'MESSAGE_TOO_LONG' : 'MESSAGE_FIELD')
    return kept
}

/** Who changes a company's messages: one of its people, or the Super Admin. */
type Actor = { id: string; name: string; role?: string }
type Db = Prisma.TransactionClient | typeof prisma

/**
 * The company whose messages these are, where its package has the client
 * portal (§7.1): read from the company itself, not from whoever acts, as the
 * Super Admin's session has every module whatever the company bought.
 */
async function portalCompany(companyId: string): Promise<{ id: string; name: string }> {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, package: PACKAGE_FACTS } })
    if (!company) throw new Error('COMPANY_NOT_FOUND')
    if (!hasModule(resolveBundles(company.package), 'TAX_POSITION')) throw new Error('CLIENT_PORTAL_NOT_IN_PACKAGE')
    return { id: company.id, name: company.name }
}

/** Nizmo's text of a message, as the Super Admin changed it or as written. */
async function nizmoText(db: Db, kind: MessageKind, language: MessageLanguage): Promise<string> {
    const row = await db.clientMessageTemplate.findFirst({ where: { companyId: null, kind, language }, select: { text: true } })
    return row?.text ?? NIZMO_MESSAGES[kind][language]
}

const own = (kind: MessageKind, language: MessageLanguage, row: Kept): CompanyMessage =>
    ({ kind, language, text: row.text, own: true, changedBy: row.updatedByName, changedAt: row.updatedAt.toISOString() })
/**
 * Nizmo's text, as the company uses it. Where the company never changed the
 * message there's no who and when, and nothing for a save to say it started
 * from; where it put Nizmo's back, its row says who did and when, which a
 * save then says it started from.
 */
const nizmos = (kind: MessageKind, language: MessageLanguage, text: string, putBack: Kept | null = null): CompanyMessage =>
    ({ kind, language, text, own: false, changedBy: putBack?.updatedByName ?? null, changedAt: putBack?.updatedAt.toISOString() ?? null })

/**
 * Each of a company's messages in each language, as it uses them (§7.1,
 * step 10c-1; PR 348): its own copy, else Nizmo's, as the Super Admin
 * changed it or as written. Contact the accountant's first, Arabic before
 * English.
 */
export async function companyMessages(companyId: string): Promise<CompanyMessage[]> {
    await portalCompany(companyId)
    const rows = await prisma.clientMessageTemplate.findMany({
        where: { OR: [{ companyId }, { companyId: null }] },
        select: { companyId: true, kind: true, language: true, text: true, usesNizmo: true, updatedByName: true, updatedAt: true },
    })
    return MESSAGE_KINDS.flatMap(kind => MESSAGE_LANGUAGES.map(language => {
        const mine = rows.find(r => r.companyId === companyId && r.kind === kind && r.language === language)
        if (mine && !mine.usesNizmo) return own(kind, language, mine)
        return nizmos(kind, language, rows.find(r => r.companyId === null && r.kind === kind && r.language === language)?.text ?? NIZMO_MESSAGES[kind][language], mine ?? null)
    }))
}

/** Who did it, as the audit log keeps them. */
const loggedBy = (by: Actor) => by.role === 'SUPER_ADMIN' ? { userId: null, superAdminId: by.id } : { userId: by.id, superAdminId: null }

/**
 * A company's own copy of one message, changed by one of its people or the
 * Super Admin (§7.1): refused as Nizmo's are where the text doesn't pass the
 * checks, and where the company's copy was changed, made or put back to
 * Nizmo's since the page read it (MESSAGE_CHANGED_SINCE): `since` is the
 * time of the message's row it read, a copy or Nizmo's put back, none where
 * the company never changed it. A text the same as
 * the one the company uses writes nothing, so Nizmo's unchanged makes no
 * copy. Each change is in the audit log, with the company, what it was and
 * what it is.
 */
export async function saveCompanyMessage(
    by: Actor,
    companyId: string,
    { kind, language, text, since }: { kind: MessageKind; language: MessageLanguage; text: string; since: string | null },
): Promise<CompanyMessage> {
    const kept = checked(kind, text)
    const company = await portalCompany(companyId)
    try {
        return await prisma.$transaction(async tx => {
            const row = await tx.clientMessageTemplate.findFirst({
                where: { companyId: company.id, kind, language },
                select: { id: true, text: true, usesNizmo: true, updatedByName: true, updatedAt: true },
            })
            if ((row?.updatedAt.toISOString() ?? null) !== since) throw new Error('MESSAGE_CHANGED_SINCE')
            const copy = row && !row.usesNizmo ? row : null
            const before = copy?.text ?? await nizmoText(tx, kind, language)
            if (kept === before) return copy ? own(kind, language, copy) : nizmos(kind, language, before, row)
            // A Super Admin isn't one of the company's people: their name alone is kept.
            const who = { updatedById: by.role === 'SUPER_ADMIN' ? null : by.id, updatedByName: by.name }
            let saved: Kept & { id: string }
            if (row) {
                // Only where it's still as it was read: a save that came first has moved its time on.
                const { count } = await tx.clientMessageTemplate.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { text: kept, usesNizmo: false, ...who } })
                if (count === 0) throw new Error('MESSAGE_CHANGED_SINCE')
                saved = await tx.clientMessageTemplate.findUniqueOrThrow({ where: { id: row.id }, select: { id: true, text: true, updatedByName: true, updatedAt: true } })
            } else {
                saved = await tx.clientMessageTemplate.create({
                    data: { companyId: company.id, kind, language, text: kept, ...who },
                    select: { id: true, text: true, updatedByName: true, updatedAt: true },
                })
            }
            await AuditLogService.log('UPDATE_CLIENT_MESSAGE', 'CLIENT_MESSAGE', saved.id, {
                tx,
                ...loggedBy(by),
                details: { company: company.name, message: AUDIT_MESSAGE[kind], language: AUDIT_LANGUAGE[language], before, after: kept },
            })
            return own(kind, language, saved)
        })
    } catch (e) {
        // Another save made the company's copy first, its row the one there can be.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new Error('MESSAGE_CHANGED_SINCE')
        throw e
    }
}

/**
 * Use Nizmo's message (§7.1): the company uses Nizmo's again, with the
 * Super Admin's later changes. Its row stays, marked as using Nizmo's, by
 * who put it back and when: were it to go, a page that read Nizmo's before
 * a copy was made and put back couldn't be told from one that read it
 * since (PR 348, Codex). Refused where the message was changed, made or
 * put back since the page read it (MESSAGE_CHANGED_SINCE). Where the
 * company uses Nizmo's already, nothing is written. In the audit log with
 * the company, what it was and what it is.
 */
async function putBack(
    tx: Prisma.TransactionClient,
    by: Actor,
    company: { id: string; name: string },
    kind: MessageKind,
    language: MessageLanguage,
    since: string | null,
): Promise<CompanyMessage> {
    const row = await tx.clientMessageTemplate.findFirst({
        where: { companyId: company.id, kind, language },
        select: { id: true, text: true, usesNizmo: true, updatedByName: true, updatedAt: true },
    })
    if ((row?.updatedAt.toISOString() ?? null) !== since) throw new Error('MESSAGE_CHANGED_SINCE')
    const nizmo = await nizmoText(tx, kind, language)
    if (!row || row.usesNizmo) return nizmos(kind, language, nizmo, row)
    // Only where it's still as it was read: a save that came first has moved its time on.
    const { count } = await tx.clientMessageTemplate.updateMany({
        where: { id: row.id, updatedAt: row.updatedAt },
        data: { usesNizmo: true, updatedById: by.role === 'SUPER_ADMIN' ? null : by.id, updatedByName: by.name },
    })
    if (count === 0) throw new Error('MESSAGE_CHANGED_SINCE')
    const marked = await tx.clientMessageTemplate.findUniqueOrThrow({ where: { id: row.id }, select: { text: true, updatedByName: true, updatedAt: true } })
    await AuditLogService.log('USE_NIZMO_CLIENT_MESSAGE', 'CLIENT_MESSAGE', row.id, {
        tx,
        ...loggedBy(by),
        details: { company: company.name, message: AUDIT_MESSAGE[kind], language: AUDIT_LANGUAGE[language], before: row.text, after: nizmo },
    })
    return nizmos(kind, language, nizmo, marked)
}

/** Use Nizmo's message for one language (step 10c-1, PR 348). */
export async function nizmoMessageAgain(
    by: Actor,
    companyId: string,
    { kind, language, since }: { kind: MessageKind; language: MessageLanguage; since: string | null },
): Promise<CompanyMessage> {
    const company = await portalCompany(companyId)
    return prisma.$transaction(tx => putBack(tx, by, company, kind, language, since))
}

/**
 * Use Nizmo's message for every language the company changed, as the Client
 * portal tab asks (§7.1, step 10c-2; PR 349): each language from the time of
 * its message the tab read, all of them or, where one was changed, made or
 * put back since, none (MESSAGE_CHANGED_SINCE). Arabic first, one after the
 * other in one transaction.
 */
export async function nizmoMessagesAgain(
    by: Actor,
    companyId: string,
    { kind, since }: { kind: MessageKind; since: Record<MessageLanguage, string | null> },
): Promise<CompanyMessage[]> {
    const company = await portalCompany(companyId)
    return prisma.$transaction(async tx => {
        const back: CompanyMessage[] = []
        for (const language of MESSAGE_LANGUAGES) back.push(await putBack(tx, by, company, kind, language, since[language]))
        return back
    })
}
