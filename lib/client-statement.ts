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

export type Statement = {
    company: { name: string; logoUrl: string | null }
    client: { id: string; name: string; ownerName: string }
    period: StatementPeriod
    /** The day it was issued, where the company is: each charge is as it is that day. */
    issuedOn: string
    charges: StatementCharge[]
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
