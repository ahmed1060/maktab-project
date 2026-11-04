import { prisma } from "@/lib/prisma"
import { USERNAME_PATTERN } from "@/lib/username-rules"

/**
 * The account typed on the sign-in page, an email or a username (decided
 * 2026-11-03), as where-clauses for the two tables an account can be in.
 * A username never has an @ (lib/username-rules.ts), so what has one is an
 * email, matched as it always was; anything else is a username, matched
 * capitals aside, and it's one account's at most. Neither table, for what
 * couldn't be either: it's counted and checked like an unknown email.
 */
export type SignInWhere = { superAdmin: { email: string } | { id: string } | null; user: { email: string } | { id: string } | null }

export async function signInWhere(typed: string): Promise<SignInWhere> {
    if (typed.includes("@")) return { superAdmin: { email: typed }, user: { email: typed } }
    if (!USERNAME_PATTERN.test(typed)) return { superAdmin: null, user: null }
    const [named] = await prisma.$queryRaw<{ kind: "SuperAdmin" | "User"; id: string }[]>`
        SELECT 'SuperAdmin' AS kind, id FROM "SuperAdmin" WHERE lower(username) = lower(${typed})
        UNION ALL
        SELECT 'User' AS kind, id FROM "User" WHERE lower(username) = lower(${typed})
        LIMIT 1`
    if (!named) return { superAdmin: null, user: null }
    return named.kind === "SuperAdmin" ? { superAdmin: { id: named.id }, user: null } : { superAdmin: null, user: { id: named.id } }
}
