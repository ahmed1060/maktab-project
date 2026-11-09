import { parseDay } from "@/lib/day-range"
import { dayIso } from "@/lib/calendar-text"
import { cents } from "@/lib/task-costs"
import type { StatusTone } from "@/components/ui/StatusBadge"

/**
 * A client statement (CLIENTS_PLAN.md §6.9; DESIGN.md §5.5, Client
 * statement): what one client was charged in a period, with the receipts, as
 * the server works it out and the page shows it. The charges added in the
 * period and not left off its bill, each Due or Collected as it is the day
 * the statement is issued; what's still due from before the period, as one
 * line; and Still due, all of it, the figure the statement is for.
 */

/** The most charges one statement lists: past that, a shorter period is asked for. */
export const STATEMENT_MAX_CHARGES = 200

/** From one day to another, both "YYYY-MM-DD", the first first. */
export type StatementPeriod = { from: string; to: string }

/** A charge as the statement lists it. */
export type StatementCharge = {
    id: string
    /** The day it was added, where the company is. */
    day: string
    description: string | null
    task: { id: string; title: string }
    paid: number
    fee: number
    total: number
    /** The day it was collected, where the company is, or null while it's due. */
    collectedOn: string | null
    /** Its receipt, numbered among the statement's charges that have one, in its order. */
    receipt: { number: number; url: string; pdf: boolean } | null
}

export type StatementTotals = {
    paid: number
    fees: number
    /** What the period's charges come to. */
    charged: number
    /** What of them was collected. */
    collected: number
    /** What of them is still due, and how many. */
    due: number
    dueCount: number
    /** What's still due of the charges added before the period, and how many. */
    dueBefore: number
    dueBeforeCount: number
    /** All that's still due: the figure the statement is for. */
    stillDue: number
}

/**
 * The same charges added up by what they're called (DESIGN.md §5.5, Client
 * statement): every charge, as it was, or by cost name.
 */
export type StatementView = "every" | "name"

/** A cost name and the period's charges under it. */
export type StatementName = {
    /** What its charges' names match by (costNameKey); "" for No name. */
    key: string
    /** As the statement says it, or null for No name. */
    name: string | null
    /** Its charges, in the statement's order. */
    ids: string[]
    paid: number
    fee: number
    total: number
}

export type Statement = {
    company: { name: string; logoUrl: string | null }
    client: { id: string; name: string; ownerName: string }
    period: StatementPeriod
    /** The day it was issued, where the company is: each charge is as it is that day. */
    issuedOn: string
    charges: StatementCharge[]
    /** Its charges by cost name, highest total first. */
    names: StatementName[]
    totals: StatementTotals
}

const isoOf = (date: Date) => date.toISOString().slice(0, 10)

/** Last month, from today's day where the company is: the period a statement opens on. */
export function lastMonth(today: string): StatementPeriod {
    const day = parseDay(today)
    if (!day) throw new Error(`not a day: ${today}`)
    return {
        from: isoOf(new Date(Date.UTC(day.year, day.month - 2, 1))),
        to: isoOf(new Date(Date.UTC(day.year, day.month - 1, 0))),
    }
}

/**
 * The period asked for: both of its days, in order. Without both, last month,
 * as the client's Charges picks both of its dates or neither.
 */
export function statementPeriod(from: unknown, to: unknown, today: string): StatementPeriod {
    const first = typeof from === "string" && parseDay(from) ? from : null
    const last = typeof to === "string" && parseDay(to) ? to : null
    if (!first || !last) return lastMonth(today)
    return first <= last ? { from: first, to: last } : { from: last, to: first }
}

/** Where Statement on a client's Charges goes: with the dates picked there, both or none. */
export function statementHref(clientId: string, dateFrom: string, dateTo: string): string {
    const path = `/dashboard/clients/${encodeURIComponent(clientId)}/statement`
    const [from, to] = [dayIso(dateFrom), dayIso(dateTo)]
    return from && to && from === dateFrom && to === dateTo ? `${path}?${new URLSearchParams({ from, to })}` : path
}

/** A receipt that's a PDF, by its file's name: a file of its own, which isn't printed. */
export function isPdfReceipt(url: string): boolean {
    try {
        return /\.pdf$/i.test(new URL(url).pathname)
    } catch {
        return false
    }
}

/** The receipts numbered in the statement's order, among the charges that have one. */
export function numberReceipts(rows: (Omit<StatementCharge, "receipt"> & { receiptUrl: string | null })[]): StatementCharge[] {
    let number = 0
    return rows.map(({ receiptUrl, ...row }) => ({
        ...row,
        receipt: receiptUrl ? { number: ++number, url: receiptUrl, pdf: isPdfReceipt(receiptUrl) } : null,
    }))
}

/**
 * What the period's charges come to, what of them was collected and is
 * still due, and all that's still due, with what's due from before.
 */
export function statementTotals(charges: StatementCharge[], before: { amount: number; count: number }): StatementTotals {
    const sum = (pick: (c: StatementCharge) => number, of: StatementCharge[] = charges) => cents(of.reduce((s, c) => s + pick(c), 0))
    const due = charges.filter(c => !c.collectedOn)
    const charged = sum(c => c.total)
    const collected = sum(c => c.total, charges.filter(c => c.collectedOn))
    const dueNow = sum(c => c.total, due)
    const dueBefore = cents(before.amount)
    return {
        paid: sum(c => c.paid),
        fees: sum(c => c.fee),
        charged,
        collected,
        due: dueNow,
        dueCount: due.length,
        dueBefore,
        dueBeforeCount: before.count,
        stillDue: cents(dueNow + dueBefore),
    }
}

/** What the statement's note says, and its colour (DESIGN.md §2.3). */
export function statementNote(totals: StatementTotals): { key: "statement_note_both" | "statement_note_period" | "statement_note_before" | "statement_note_clear"; tone: StatusTone } {
    if (totals.dueCount > 0 && totals.dueBeforeCount > 0) return { key: "statement_note_both", tone: "waiting" }
    if (totals.dueCount > 0) return { key: "statement_note_period", tone: "waiting" }
    if (totals.dueBeforeCount > 0) return { key: "statement_note_before", tone: "waiting" }
    return { key: "statement_note_clear", tone: "good" }
}

// Arabic's vowel marks (U+064B to U+065F, and the dagger alef U+0670) and
// its stretch line (U+0640): how a word was typed, not which word it is.
const ARABIC_MARKS = /[\u064B-\u065F\u0670\u0640]/g

/**
 * What a cost's name is matched by (DESIGN.md §5.5, Client statement): the
 * name with capitals, spaces, Arabic's letter forms (أ إ آ ٱ as ا, ة as ه,
 * ى as ي), its vowel marks and the stretch line set aside. Nothing else is
 * guessed: another word, or a typo, is a name of its own. "" for no name.
 */
export function costNameKey(name: string | null | undefined): string {
    return (name ?? "")
        .replace(ARABIC_MARKS, "")
        .replace(/[أإآٱ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
}

/** A name as it was typed, its spaces tidied. */
const tidy = (name: string) => name.replace(/\s+/g, " ").trim()

/** The one given most often, the first of them where it's a tie. */
function mostOften(names: readonly string[]): string | undefined {
    const counts = new Map<string, number>()
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
    let best: string | undefined
    for (const [name, count] of counts) if (best === undefined || count > counts.get(best)!) best = name
    return best
}

/**
 * The period's charges added up by cost name, highest total first; names
 * with the same total alphabetically, and No name last of those.
 *
 * A charge picked from the saved list is under the list's name as it is now
 * (`entryName`); a typed one is under a name it matches (costNameKey). Typed
 * only, a name is shown as the company's saved list has it (`saved`, the
 * first of any that match), or else as it was typed most often.
 */
export function byCostName(
    charges: readonly { id: string; description: string | null; entryName: string | null; paid: number; fee: number; total: number }[],
    saved: readonly string[],
): StatementName[] {
    const savedByKey = new Map<string, string>()
    for (const name of saved) {
        const key = costNameKey(name)
        if (key && !savedByKey.has(key)) savedByKey.set(key, name)
    }
    const groups = new Map<string, { picked: string[]; typed: string[]; ids: string[]; paid: number; fee: number; total: number }>()
    for (const c of charges) {
        const picked = c.entryName !== null && costNameKey(c.entryName) !== ""
        const key = costNameKey(picked ? c.entryName : c.description)
        const group = groups.get(key) ?? { picked: [], typed: [], ids: [], paid: 0, fee: 0, total: 0 }
        if (picked) group.picked.push(c.entryName!)
        else if (key) group.typed.push(tidy(c.description!))
        group.ids.push(c.id)
        group.paid += c.paid
        group.fee += c.fee
        group.total += c.total
        groups.set(key, group)
    }
    const names: StatementName[] = [...groups].map(([key, g]) => ({
        key,
        name: key === "" ? null : mostOften(g.picked) ?? savedByKey.get(key) ?? mostOften(g.typed)!,
        ids: g.ids,
        paid: cents(g.paid),
        fee: cents(g.fee),
        total: cents(g.total),
    }))
    return names.sort((a, b) =>
        b.total - a.total
        || (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0)
        || (a.name ?? "").localeCompare(b.name ?? ""))
}

/** A name's receipts on a statement by cost name, each with its number there. */
export type NameReceipts = {
    name: StatementName
    receipts: { charge: StatementCharge; number: number }[]
    /** Its charges with no receipt, said under the receipts. */
    missing: StatementCharge[]
}

/**
 * By cost name, the receipts under each name, in the table's order, numbered
 * in that order; only the names with one.
 */
export function receiptsByName(names: readonly StatementName[], charges: readonly StatementCharge[]): NameReceipts[] {
    const byId = new Map(charges.map(c => [c.id, c]))
    const groups: NameReceipts[] = []
    let number = 0
    for (const name of names) {
        const under = name.ids.map(id => byId.get(id)).filter((c): c is StatementCharge => c !== undefined)
        const withReceipt = under.filter(c => c.receipt)
        if (withReceipt.length === 0) continue
        groups.push({
            name,
            receipts: withReceipt.map(charge => ({ charge, number: ++number })),
            missing: under.filter(c => !c.receipt),
        })
    }
    return groups
}
