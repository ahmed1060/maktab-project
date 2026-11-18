import { fetchRetrying } from "./swr-fetcher"
import {
    claimOf, compareClaims, dayFromFileName, fileNamesClient, namedCompany, remainingOf,
    type ClaimDraft, type TaxClaimsNow, type TaxFile, type TaxMistake, type TaxUpload, type TaxUploadSaved,
} from "./tax-file"

/**
 * The upload's check screen (CLIENT_PORTAL_PLAN.md §4.1; DESIGN.md §5.5,
 * Uploading the tax portal's file; PR 316): what a file read in the browser
 * would do to the client's claims, worked out before anything is saved, and
 * what the screen asks the server.
 */

/** Where a file is checked against the client's claims, and saved. */
export const TAX_UPLOAD_URL = "/api/tax-claims/upload"

/** A row the file has wrong: where it is, its claim's number, and what's wrong with it. */
export type TaxRowProblem = { line: number; claimNumber: string; mistakes: TaxMistake[] }

/** One thing that changed of a claim: an amount or its last day to pay, with what it was and is, or anything else of it. */
export type TaxChange =
    | { what: "original" | "paid" | "remaining"; before: number; after: number }
    | { what: "due"; before: string; after: string }
    | { what: "details" }

export type TaxCheck = {
    /** The file's open claims, as a save sends them. All of them only where no row has a problem. */
    claims: ClaimDraft[]
    /** The rows with a problem, which stop the save: saving the rest would delete their claims. */
    problems: TaxRowProblem[]
    added: ClaimDraft[]
    changed: { before: ClaimDraft; after: ClaimDraft; changes: TaxChange[] }[]
    /** What the client has that the file hasn't, and so goes. */
    gone: ClaimDraft[]
    same: number
    /** What remains to pay now, and what will once it's saved. */
    owedNow: number
    owedAfter: number
    /** The company the file names, or nothing. */
    company: string | null
    /** Whether that's plainly this client. Where it isn't, saving asks first. */
    namesClient: boolean
    /** Rows left out as having nothing left to pay. */
    paid: number
    /** Rows left out for their status, by status. */
    otherStatuses: { status: string; rows: number }[]
}

const AMOUNTS = [["original", "originalAmount"], ["paid", "paidAmount"], ["remaining", "remainingAmount"]] as const
const DETAILS = ["item", "taxType", "registrationType", "currency", "status", "periodStart", "periodEnd"] as const
const piastres = (amount: number) => Math.round(amount * 100)

/** What changed of a claim, for the check screen to say: its amounts to the piastre, its last day to pay, then anything else. */
export function changesOf(before: ClaimDraft, after: ClaimDraft): TaxChange[] {
    const changes: TaxChange[] = []
    for (const [what, field] of AMOUNTS) {
        if (piastres(before[field]) !== piastres(after[field])) changes.push({ what, before: before[field], after: after[field] })
    }
    if (before.dueDate !== after.dueDate) changes.push({ what: "due", before: before.dueDate, after: after.dueDate })
    if (DETAILS.some(field => before[field] !== after[field])) changes.push({ what: "details" })
    return changes
}

/**
 * What a file would do to the client's claims (§4.1): what's new, what
 * changed, what isn't in it and goes, and the rows with a problem.
 */
export function checkTaxFile(file: TaxFile, now: TaxClaimsNow): TaxCheck {
    const problems = file.rows.filter(row => row.mistakes.length > 0).map(row => ({ line: row.line, claimNumber: row.claimNumber, mistakes: row.mistakes }))
    const claims = file.rows.map(claimOf).filter((claim): claim is ClaimDraft => claim !== null)
    const { added, changed, gone, same } = compareClaims(now.claims, claims)
    const forStatus = file.otherStatuses.reduce((sum, other) => sum + other.rows, 0)
    return {
        claims,
        problems,
        added,
        changed: changed.map(change => ({ ...change, changes: changesOf(change.before, change.after) })),
        gone,
        same,
        owedNow: remainingOf(now.claims),
        owedAfter: remainingOf(claims),
        company: namedCompany(file.company),
        namesClient: fileNamesClient(file.company, now.client.name, now.fileCompany),
        paid: file.leftOut - forStatus,
        otherStatuses: file.otherStatuses,
    }
}

/** The day the figures are from, to start with (§4.1): the day in the file's name, or today where it has none. It can be changed. */
export function asOfFor(fileName: string, today: string): string {
    return dayFromFileName(fileName, today) ?? today
}

/** What a save sends: the claims the browser read, never the file. */
export function uploadOf(now: TaxClaimsNow, file: TaxFile, check: TaxCheck, picked: { asOf: string; fileName: string; confirmed: boolean }): TaxUpload {
    return { clientId: now.client.id, uploads: now.uploads, asOf: picked.asOf, fileName: picked.fileName, fileCompany: file.company, confirmed: picked.confirmed, claims: check.claims }
}

/** Why the server refused: its code, for the screen to say in its own words, and the server's. */
export type TaxRefused = { code: string | null; message: string | null }
function refusedBy(body: unknown): TaxRefused {
    const said = body as { code?: unknown; error?: unknown } | null
    return { code: typeof said?.code === "string" ? said.code : null, message: typeof said?.error === "string" && said.error ? said.error : null }
}

/** What a file is checked against, read for the client. It tries again by itself, as anything a screen loads does. */
export async function readClaimsNow(clientId: string): Promise<{ now: TaxClaimsNow } | { refused: TaxRefused }> {
    try {
        const res = await fetchRetrying(`${TAX_UPLOAD_URL}?${new URLSearchParams({ clientId })}`)
        const body = await res.json().catch(() => null)
        if (!res.ok || !body?.data) return { refused: refusedBy(body) }
        return { now: body.data as TaxClaimsNow }
    } catch {
        return { refused: { code: null, message: null } }
    }
}

/** Saves the file's claims as the client's. Sent once, as a save is. */
export async function saveUpload(upload: TaxUpload): Promise<{ saved: TaxUploadSaved } | { refused: TaxRefused }> {
    try {
        const res = await fetch(TAX_UPLOAD_URL, { method: "POST", body: JSON.stringify(upload), headers: { "Content-Type": "application/json" } })
        const body = await res.json().catch(() => null)
        if (!res.ok || !body?.data) return { refused: refusedBy(body) }
        return { saved: body.data as TaxUploadSaved }
    } catch {
        return { refused: { code: null, message: null } }
    }
}
