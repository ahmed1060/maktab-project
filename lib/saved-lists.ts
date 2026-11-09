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

/**
 * A cost's name where the company keeps them to its saved list
 * (CLIENTS_PLAN.md §6.9; DESIGN.md §5.3), as the field checks it on Add:
 * the name picked; or the list's name a typed one is, capitals and spaces
 * aside, taken as if picked; or what's wrong, for the field to say under it.
 * The server checks the same (ListService.named), matching the text as
 * typed, so a pattern such as "%" is no name.
 */
export async function nameOnList(
    value: { text: string; entryId: string | null },
    suggest: (typed: string) => Promise<readonly { id: string; name: string }[]>,
): Promise<{ name: { text: string; entryId: string } } | { problem: "needed" | "not_listed"; typed: string }> {
    if (value.entryId) return { name: { text: value.text, entryId: value.entryId } }
    const typed = value.text.replace(/\s+/g, " ").trim()
    if (!typed) return { problem: "needed", typed }
    const found = (await suggest(typed)).find(n => sameListName(n.name, typed))
    return found ? { name: { text: found.name, entryId: found.id } } : { problem: "not_listed", typed }
}

/** A name typed or picked, and the company whose list it was picked from. */
export type CompanyPick = { name: { text: string; entryId: string | null }; company: string | null }

/**
 * What a field picked from a company's list holds while `company` is the
 * one chosen: the name as picked, in the company it was picked in, and in
 * another its text only, as typed. A Super Admin who picks a title and then
 * switches company keeps the title, not a link to the first company's name,
 * which the task would be refused for (Codex review of PR 105).
 */
export function pickIn(pick: CompanyPick, company: string | null): CompanyPick["name"] {
    return pick.company === company || !pick.name.entryId ? pick.name : { text: pick.name.text, entryId: null }
}

/** A saved name a filter picked, with its company (§5.9). */
export type FilterName = { id: string; name: string; companyId: string }

/** For a name filter whose name its viewer's company hasn't: nothing. */
const NOTHING = { id: "__no_match__" }

/** Text for a LIKE pattern, its %, _ and \ taken as typed. */
export const likeText = (text: string) => text.replace(/[\\%_]/g, c => `\\${c}`)

/**
 * Text typed the same as a name, ignoring capitals. Prisma matches an
 * insensitive `equals` with ILIKE, so "Gate_2" would match "GateX2", and
 * "%" everything.
 */
const typedAs = (name: string) => ({ equals: likeText(name), mode: "insensitive" })

/**
 * The tasks a title filter keeps (§5.9; decided 2026-10-29): those picked as
 * the name, or typed the same, ignoring capitals, in the name's company.
 */
export function titleNamed(name: FilterName | null): Record<string, unknown> {
    if (!name) return NOTHING
    return { companyId: name.companyId, OR: [{ titleEntryId: name.id }, { title: typedAs(name.name) }] }
}

/** A task's costs a cost name filter counts, picked as the name or typed the same. */
export function costNamed(name: FilterName): Record<string, unknown> {
    return { OR: [{ nameEntryId: name.id }, { description: typedAs(name.name) }] }
}

/** The tasks with a cost a cost name filter counts, in the name's company. */
export function withCostNamed(name: FilterName | null): Record<string, unknown> {
    if (!name) return NOTHING
    return { companyId: name.companyId, costs: { some: costNamed(name) } }
}
