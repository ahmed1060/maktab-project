import { BUILT_IN_GRANTS, builtInGrantsToken, isBuiltInRole } from "./built-in"

/**
 * A test's signed-in person as their session token would carry them: with the
 * grants of the built-in role they are on, encoded as lib/auth.ts encodes them.
 *
 * For tests only. The records were written against the built-in roles, and
 * every company's built-in roles are seeded with exactly these grants — so a
 * record that passes with them passes for what the database now holds.
 */
export function withGrants<T extends { role?: string | null }>(user: T): T & { grants?: string } {
    return isBuiltInRole(user.role) ? { ...user, grants: builtInGrantsToken(user.role) } : user
}

type Person = { id: string; role: string; companyId: string | null; teamLeaderId?: string | null }

/**
 * Whether a person matches a Prisma `where` on User — enough of Prisma's
 * language for "who should be told": fields, OR and AND, `in`, and a role's
 * grants (holdersOf). The person holds their built-in role's grants, as the
 * roles migration gave them. Anything else throws rather than guessing, so a
 * query this cannot read fails its test instead of passing it.
 */
export function matchesUserWhere(person: Person, where: Record<string, any>): boolean {
    for (const [key, value] of Object.entries(where)) {
        if (key === "OR") { if (!value.some((w: any) => matchesUserWhere(person, w))) return false; continue }
        if (key === "AND") { if (!value.every((w: any) => matchesUserWhere(person, w))) return false; continue }
        if (key === "assignedRole") {
            const wanted = value?.grants?.some
            if (!wanted) throw new Error(`unsupported assignedRole condition: ${JSON.stringify(value)}`)
            const held = isBuiltInRole(person.role) ? BUILT_IN_GRANTS[person.role][wanted.permission as keyof typeof BUILT_IN_GRANTS.ADMIN] : undefined
            if (!held || (wanted.scope && held !== wanted.scope)) return false
            continue
        }
        if (value !== null && typeof value === "object") {
            if (Array.isArray(value.in)) { if (!value.in.includes((person as any)[key])) return false; continue }
            throw new Error(`unsupported condition on ${key}: ${JSON.stringify(value)}`)
        }
        if ((person as any)[key] !== value) return false
    }
    return true
}

/** The ids, sorted, of everybody in `people` a `where` on User matches. */
export function whoMatches(people: Person[], where: Record<string, any>): string[] {
    return people.filter(p => matchesUserWhere(p, where)).map(p => p.id).sort()
}
