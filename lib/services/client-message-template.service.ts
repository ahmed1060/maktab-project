import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { AuditLogService } from '@/lib/services/audit-log.service'
import {
    MESSAGE_KINDS, MESSAGE_LANGUAGES, NIZMO_MESSAGES, messageProblem, messagesFrom,
    type ClientMessages, type MessageKind, type MessageLanguage, type NizmoMessage,
} from '@/lib/client-message-template'

export type { NizmoMessage }

/**
 * The messages a company's client's people are given (CLIENT_PORTAL_PLAN.md
 * §7.1, §12 step 10a; PR 346): each of the two, in each language, the
 * company's copy, else Nizmo's as the Super Admin changed it, else Nizmo's
 * own as written. Read with the client's page, on the server, from the
 * session's company.
 */
export async function clientMessages(companyId: string): Promise<ClientMessages> {
    const kept = await prisma.clientMessageTemplate.findMany({
        where: { OR: [{ companyId }, { companyId: null }] },
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
    const kept = text.replace(/\r\n?/g, '\n')
    const problem = messageProblem(kind, kept)
    if (problem) throw new Error(problem.problem === 'empty' ? 'MESSAGE_EMPTY' : problem.problem === 'too_long' ? 'MESSAGE_TOO_LONG' : 'MESSAGE_FIELD')
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
