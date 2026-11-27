import type { Permission } from "@/lib/permissions/catalogue"

/**
 * Roles and access's tabs, each for whoever holds its permission
 * (LATER_CHANGES_PLAN.md §7.15, PR 439): Changes to roles, asking the Super
 * Admin to change a role, for whoever gives roles; Access reviews for whoever
 * answers them. The page is for whoever holds either.
 */
export type RolesAndAccessTab = "changes" | "reviews"

export function rolesAndAccessTabs(can: (permission: Permission) => boolean): RolesAndAccessTab[] {
    const tabs: RolesAndAccessTab[] = []
    if (can('employees.assign_role')) tabs.push('changes')
    if (can('employees.review_access')) tabs.push('reviews')
    return tabs
}

/** The tab asked for, as a notice's link or a reload asks it, where it's theirs; else their first. */
export function rolesAndAccessTab(asked: string | null | undefined, tabs: RolesAndAccessTab[]): RolesAndAccessTab {
    return tabs.find(t => t === asked) ?? tabs[0]
}
