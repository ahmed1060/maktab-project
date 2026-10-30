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
 * grants (holdersOf). The person holds their built-in role's grants, as
 * the roles migration gave them. Anything else throws rather than guessing, so a
 * query this cannot read fails its test instead of passing it.
 */
export function matchesUserWhere(person: Person, where: Record<string, any>): boolean {
    for (const [key, value] of Object.entries(where)) {
        if (key === "OR") { if (!value.some((w: any) => matchesUserWhere(person, w))) return false; continue }
        if (key === "AND") { if (!value.every((w: any) => matchesUserWhere(person, w))) return false; continue }
        if (key === "assignedRole") {
            const wanted = value?.grants?.some
            if (!wanted) throw new Error(`unsupported assignedRole condition: ${JSON.stringify(value)}`)
            if (typeof wanted.permission !== "string") throw new Error(`unsupported grant condition: ${JSON.stringify(wanted)}`)
            const held = isBuiltInRole(person.role) ? (BUILT_IN_GRANTS[person.role] as Record<string, string>)[wanted.permission] : undefined
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

/**
 * `role.findUnique` over every company's built-in roles, as the roles
 * migration creates them: a role's id is `${companyId}:${kind}`. Answers a
 * lookup by kind (RoleAssignmentService.builtIn) and by id, with its grants
 * (RoleAssignmentService.chosen). Anything else is not a built-in role.
 */
export async function builtInRoleLookup({ where }: { where: any }) {
    const [companyId, kind] = where.companyId_builtIn
        ? [where.companyId_builtIn.companyId, where.companyId_builtIn.builtIn]
        : String(where.id ?? "").split(":")
    if (!companyId || !isBuiltInRole(kind)) return null
    const grants = Object.entries(BUILT_IN_GRANTS[kind]).map(([permission, scope]) => ({ permission, scope }))
    return { id: `${companyId}:${kind}`, companyId, baseRole: kind, builtIn: kind, grants }
}

/**
 * A session that confirmed a high-risk action with its authenticator code a
 * moment ago (ROLES_PLAN.md §6.15). The access records are about who may do
 * what; step-up is a separate rule with its own tests (lib/step-up.test.ts),
 * so the records sign their people in as having confirmed.
 */
export function stepUpConfirmed<T extends object>(user: T): T & { mfaEnabled: true; stepUpAt: number } {
    return { ...user, mfaEnabled: true, stepUpAt: Date.now() }
}
