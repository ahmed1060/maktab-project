import { prisma } from "@/lib/prisma"
import { accountEmail } from "@/lib/client-accounts"

/**
 * One email, one account (CLIENT_PORTAL_PLAN.md §5.1; PR 322): whether an
 * email is someone's already, asked before a save so it can be said where
 * the email is typed. The database holds the rule itself, for two saves at
 * once (20270106000000_client_accounts).
 */

type Reader = Pick<typeof prisma, "$queryRaw">

/** Whether a client account has the email, capitals aside. */
export async function clientAccountHasEmail(email: string, db: Reader = prisma): Promise<boolean> {
    const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "ClientAccount" WHERE email = ${accountEmail(email)} LIMIT 1`
    return rows.length > 0
}

/** Whether one of the company's people or a Super Admin has the email, capitals aside. */
export async function personHasEmail(email: string, db: Reader = prisma): Promise<boolean> {
    const kept = accountEmail(email)
    const rows = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM "User" WHERE lower(email) = ${kept}
        UNION ALL
        SELECT id FROM "SuperAdmin" WHERE lower(email) = ${kept}
        LIMIT 1`
    return rows.length > 0
}

/**
 * Whether a save was refused for an email somebody else has: a unique index
 * caught it, or the rule across the tables, for one given a moment before
 * to a client account. Prisma names the column, the index or the rule in the
 * error's meta. It escaped as a 500 (a person's profile, part 3, PR 193).
 */
export function isEmailClash(error: unknown): boolean {
    return (error as { code?: string })?.code === "P2002" && /email/i.test(JSON.stringify((error as { meta?: unknown }).meta ?? {}))
}
