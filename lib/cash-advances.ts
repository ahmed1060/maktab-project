import { cents } from "@/lib/task-costs"
import type { TranslationKey } from "@/lib/translations"

/**
 * Cash advances (CLIENTS_PLAN.md §7), as the Cash advances tab, My cash
 * advance and the server all take them.
 */

/** The entries a person records (§7.3, §7.4). Spent ones come with costs, in 7b. */
export const RECORDED_KINDS = ["GIVEN", "RETURNED", "CORRECTION"] as const
export type RecordedKind = typeof RECORDED_KINDS[number]
export type EntryKind = RecordedKind | "SPENT" | "DEBT" | "MOVED"

/**
 * What an entry's money is for (§7.9): one task or one client, or neither,
 * the running balance.
 */
export type AdvanceFor = { taskId: string | null; clientId: string | null }

/**
 * What an advance is for, as sent: a task, a client, or neither. Null for
 * what can't be: both at once, or one that isn't an id.
 */
export function forOf(input: { forTaskId?: unknown; forClientId?: unknown }): AdvanceFor | null {
    const id = (raw: unknown): string | null | undefined =>
        raw === undefined || raw === null || raw === "" ? null : typeof raw === "string" && raw.length <= 64 ? raw : undefined
    const taskId = id(input.forTaskId)
    const clientId = id(input.forClientId)
    if (taskId === undefined || clientId === undefined || (taskId && clientId)) return null
    return { taskId, clientId }
}

/** What a person holds for one task or one client (§7.9), as their advance's page reads it. */
export type HeldPart = { forTask: { id: string; title: string } | null; forClient: { id: string; name: string } | null; amount: number }

/** One part of an advance a cost here is paid from, in the order it pays (§7.9). */
export type PaysFrom = { kind: "task"; amount: number } | { kind: "client"; name: string; amount: number } | { kind: "running"; amount: number }

/**
 * What pays a cost added on a task, as Add cost says it (§7.9): what's held
 * for the task, then for its client, then the running balance, each that
 * holds anything. Money for any other task or client never does.
 */
export function paysFirst(held: readonly HeldPart[], running: number, on: { taskId: string; clientId: string | null }): PaysFrom[] {
    const task = held.find(h => h.forTask?.id === on.taskId)
    const client = on.clientId ? held.find(h => h.forClient?.id === on.clientId) : undefined
    const parts: PaysFrom[] = [
        { kind: "task", amount: task?.amount ?? 0 },
        { kind: "client", name: client?.forClient?.name ?? "", amount: client?.amount ?? 0 },
        { kind: "running", amount: running },
    ]
    return parts.filter(p => p.amount > 0)
}

/** The most one entry moves, as for a service fee (§7.8). */
export const CASH_ADVANCE_MAX = 1_000_000

/** The longest note an entry keeps. */
export const CASH_ADVANCE_NOTE_MAX = 500

/** The upload route's folder for photos of signed hand-overs (§7.3). */
export const HANDOVER_FOLDER = "cash-advances"
export const HANDOVER_ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.pdf"

/** Whether a company uses cash advances: the Super Admin allowed them, and its Admin hasn't switched them off (§7.6). */
export function cashAdvancesInUse(company: { cashAdvancesAllowed: boolean; cashAdvancesOn: boolean } | null | undefined): boolean {
    return !!company?.cashAdvancesAllowed && !!company.cashAdvancesOn
}

/**
 * An entry's amount as stored, signed (§7.4), from what was typed: an amount
 * given adds to the balance, one returned takes from it, and a correction
 * says which. Null for what can't be one: nothing, below a piastre, or over
 * the most an entry moves.
 */
export function signedAmount(kind: RecordedKind, raw: unknown): number | null {
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw
    if (typeof value !== "number" || !Number.isFinite(value)) return null
    const amount = cents(value)
    if (amount === 0 || Math.abs(amount) > CASH_ADVANCE_MAX) return null
    if (kind === "CORRECTION") return amount
    if (amount < 0) return null
    return kind === "GIVEN" ? amount : -amount
}

/** The balance after an entry, or null if it would go below zero (§7.4). */
export function balanceAfter(balance: number, amount: number): number | null {
    const next = cents(balance + amount)
    return next < 0 ? null : next
}

/** A day as the form sends it, "2026-10-30", if it's one: a real day of the calendar. */
export function dayOf(raw: unknown): string | null {
    if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
    const date = new Date(`${raw}T00:00:00Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : null
}

/** A day as the form offers it: today where the person is, "2026-10-30". */
export function todayHere(now: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * The refusals a screen says in the person's language, by the code the
 * server answers with; any other is shown as the server words it.
 */
export const REFUSAL_KEYS = {
    CASH_ADVANCES_OFF: "advances_off",
    CASH_ADVANCES_HELD: "advances_held_refusal",
    CASH_ADVANCE_NOT_AT_WORK: "advances_not_at_work",
    CASH_ADVANCE_MORE_THAN_HELD: "advances_more_than_held",
    CASH_ADVANCE_BELOW_ZERO: "advances_below_zero",
    CASH_ADVANCE_ALREADY_CONFIRMED: "advances_already_confirmed",
    CASH_ADVANCE_PHOTO_INVALID: "advances_photo_invalid",
    CASH_ADVANCE_DATE_INVALID: "advances_date_invalid",
    CASH_ADVANCE_FOR_INVALID: "advances_for_invalid",
    CASH_ADVANCE_NOT_ON_TASK: "advances_not_on_task",
    CASH_ADVANCE_TASK_DONE: "advances_task_done",
    CASH_ADVANCE_CLIENT_ARCHIVED: "advances_client_archived",
} as const satisfies Record<string, TranslationKey>

/** What to tell the person when the server refuses, in their language where it can be. */
export function refusalText(t: (key: TranslationKey) => string, answer: { code?: unknown; error?: unknown } | null | undefined): string {
    const key = typeof answer?.code === "string" ? (REFUSAL_KEYS as Record<string, TranslationKey>)[answer.code] : undefined
    if (key) return t(key)
    return typeof answer?.error === "string" && answer.error ? answer.error : t("error_generic")
}

/**
 * A day an entry keeps, "30 Oct 2026", as it is wherever the person is: a
 * day, not a moment, so it isn't moved by their time zone.
 */
export function dayLabel(day: string, locale: string): string {
    const date = new Date(`${day}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return day
    return date.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}
