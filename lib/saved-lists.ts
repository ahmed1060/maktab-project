import type { ListKind } from "@prisma/client"

/**
 * The saved lists' rules both sides share (CLIENTS_PLAN.md §5): which lists
 * there are, and what a name in each may be.
 */

export const LIST_KINDS: readonly ListKind[] = ["TASK_TITLE", "COST_NAME"]

/** As the fields that take them allow: a task's title, a cost's name. */
export const LIST_NAME_LIMITS: Record<ListKind, { min: number; max: number }> = {
    TASK_TITLE: { min: 3, max: 100 },
    COST_NAME: { min: 1, max: 200 },
}

/** A name as a list keeps it: trimmed, and as long as its field allows. */
export function listName(kind: ListKind, raw: unknown): string {
    const name = typeof raw === "string" ? raw.trim() : ""
    const { min, max } = LIST_NAME_LIMITS[kind]
    if (!name) throw new Error("LIST_NAME_REQUIRED")
    if (name.length < min) throw new Error("LIST_NAME_TOO_SHORT")
    if (name.length > max) throw new Error("LIST_NAME_TOO_LONG")
    return name
}

/** Whether what's typed is that name, ignoring capitals and the spaces around it. */
export function sameListName(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase()
}
