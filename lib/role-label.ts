import type { TranslationKey } from "@/lib/translations"

/**
 * A role's name as people read it.
 *
 * The built-in roles are rows like any other (ROLES_PLAN.md §7 step 3), so
 * their names are stored — in English. They cannot be renamed, so their name
 * says nothing the kind does not: shown in the reader's language instead. A
 * role the Super Admin made is shown by the name they gave it.
 */

export const BUILT_IN_LABEL = {
    ADMIN: "role_admin",
    TEAM_LEADER: "role_team_leader",
    EMPLOYEE: "role_employee",
} as const satisfies Record<string, TranslationKey>

export type RoleNamed = { name: string; builtIn?: string | null }

export function roleLabel(role: RoleNamed | null | undefined, t: (key: TranslationKey) => string, none = "—"): string {
    if (!role) return none
    const key = role.builtIn ? BUILT_IN_LABEL[role.builtIn as keyof typeof BUILT_IN_LABEL] : undefined
    return key ? t(key) : role.name
}
