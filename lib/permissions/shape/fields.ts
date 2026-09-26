import type { Permission } from "../catalogue"

/**
 * Every protected field, and the permission that reveals it (ROLES_PLAN.md §3.7).
 *
 * A route check answers "may you call this?"; this list answers "which of the
 * answer may you see?". Adding a sensitive column means adding it here, and
 * lib/permissions/shape/shape.test.ts then fails until its model's shaper
 * handles it.
 *
 * What is always yours is not in the permission: your own salary, your own
 * line of a task's payments. The shapers apply that.
 */
export const PROTECTED_FIELDS = {
    User: {
        salary: "salary.view",
    },
    Task: {
        // Per assignee. Without the permission you see only your own entry.
        memberCosts: "tasks.view",
    },
} as const satisfies Record<string, Record<string, Permission>>
