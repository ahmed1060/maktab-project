import { prisma } from '@/lib/prisma'
import { messagesFrom, type ClientMessages } from '@/lib/client-message-template'

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
