import { PERMISSIONS, permissionForCode, type Permission, type Scope } from "./catalogue"

/**
 * A role's grants: which permissions, at which scope.
 *
 * The same shape everywhere — the built-in table, a role loaded from the
 * database, a session token once decoded — so can() has one thing to read.
 */
export type Grants = Partial<Record<Permission, Scope>>

const SCOPE_DIGIT: Record<Scope, string> = { OWN: "1", TEAM: "2", COMPANY: "3" }
const DIGIT_SCOPE: Record<string, Scope> = { "1": "OWN", "2": "TEAM", "3": "COMPANY" }

/**
 * Grants as the session token carries them: "code.scope" pairs, comma
 * separated — "1.3,14.2" is employees.view at COMPANY and tasks.view at TEAM.
 * A role holding every permission is a couple of hundred bytes.
 */
export function encodeGrants(grants: Grants): string {
    return (Object.entries(grants) as [Permission, Scope][])
        .map(([permission, scope]) => [PERMISSIONS[permission].code, SCOPE_DIGIT[scope]] as const)
        .sort(([a], [b]) => a - b)
        .map(([code, digit]) => `${code}.${digit}`)
        .join(",")
}

const decoded = new Map<string, Grants>()

/**
 * The reverse, forgiving of what it does not know: an unknown code or scope is
 * dropped, never guessed. A token from a newer release read by an older one
 * simply holds less.
 */
export function decodeGrants(encoded: string | null | undefined): Grants {
    if (!encoded) return {}
    const hit = decoded.get(encoded)
    if (hit) return hit
    const grants: Grants = {}
    for (const pair of encoded.split(",")) {
        const [code, digit] = pair.split(".")
        const permission = permissionForCode(Number(code))
        const scope = DIGIT_SCOPE[digit]
        if (permission && scope) grants[permission] = scope
    }
    // Every request asks can() many times with the same token; decode once.
    if (decoded.size > 500) decoded.clear()
    decoded.set(encoded, grants)
    return grants
}
