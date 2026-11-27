import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

/**
 * The client picked for new work, a task's or an obligation's
 * (CLIENTS_PLAN.md §4.3; LATER_CHANGES_PLAN.md §7.7, 7a): there, the work's
 * company's, and not archived, as an archived client takes no new work.
 */
export async function clientFor(clientId: string, companyId: string | null | undefined): Promise<string> {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, companyId: true, archivedAt: true } })
    if (!client) throw new Error("CLIENT_NOT_FOUND")
    if (client.companyId !== companyId) throw new Error("CROSS_COMPANY_CLIENT_FORBIDDEN")
    if (client.archivedAt) throw new Error("CLIENT_ARCHIVED")
    return client.id
}

/**
 * The work's client, held until the work is written, as archiving holds it
 * (CLIENTS_PLAN.md §4.3): one archived meanwhile is seen here, and takes no
 * new work.
 */
export async function holdClientInUse(tx: Prisma.TransactionClient, clientId: string) {
    const [held] = await tx.$queryRaw<{ archived: boolean }[]>`SELECT "archivedAt" IS NOT NULL AS archived FROM "Client" WHERE id = ${clientId} FOR SHARE`
    if (!held) throw new Error("CLIENT_NOT_FOUND")
    if (held.archived) throw new Error("CLIENT_ARCHIVED")
}
