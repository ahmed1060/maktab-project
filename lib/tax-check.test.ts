import { describe, it, expect, vi, afterEach } from "vitest"
import { asOfFor, changesOf, checkTaxFile, readClaimsNow, saveUpload, uploadOf, TAX_UPLOAD_URL } from "./tax-check"
import { readTaxSheet, sentUpload, TAX_FILE_HEADINGS as H, UNNAMED_COMPANY, type ClaimDraft, type TaxClaimsNow, type TaxFile, type TaxSheetRow } from "./tax-file"

/**
 * The upload's check screen (CLIENT_PORTAL_PLAN.md §4.1, §15; DESIGN.md §5.5,
 * Uploading the tax portal's file; PR 316): what a file read in the browser
 * would do to the client's claims, worked out before anything is saved.
 * The companies and claims here are made up.
 */

const ALEF = "شركة ألف للتجارة"
const HEAD = [H.company, H.taxType, H.item, H.registrationType, H.claimNumber, H.original, H.paid, H.remaining, H.currency, H.status, H.periodStart, H.periodEnd, H.dueDate]
const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
const row = (number: unknown, original: unknown, paid: unknown, remaining: unknown, over: Record<number, unknown> = {}) =>
    Object.assign([ALEF, "دخل", "أقرار تجاري", "", number, original, paid, remaining, "جنيه مصري", "في انتظار السداد", day("2025-01-01"), day("2025-12-31"), day("2026-04-30")], over)
const file = (...rows: unknown[][]): TaxFile => {
    const read = readTaxSheet([HEAD, ...rows].map((cells, i): TaxSheetRow => ({ line: i + 1, cells })))
    if ("problem" in read) throw new Error(`refused: ${JSON.stringify(read)}`)
    return read
}
const claim = (claimNumber: string, originalAmount: number, paidAmount: number, remainingAmount: number, over: Partial<ClaimDraft> = {}): ClaimDraft => ({
    claimNumber, item: "أقرار تجاري", taxType: "دخل", registrationType: null, originalAmount, paidAmount, remainingAmount,
    currency: "جنيه مصري", status: "في انتظار السداد", periodStart: "2025-01-01", periodEnd: "2025-12-31", dueDate: "2026-04-30", ...over,
})
const now = (claims: ClaimDraft[], over: Partial<TaxClaimsNow> = {}): TaxClaimsNow =>
    ({ client: { id: "noor", name: ALEF }, today: "2026-11-18", uploads: claims.length ? 1 : 0, fileCompany: null, claims, ...over })

describe("what a file would do to the client's claims", () => {
    it("has every claim new the first time, and what's owed after", () => {
        const check = checkTaxFile(file(row("000101", 1000, 0, 1000), row("000102", 500.5, 200.25, 300.25)), now([]))
        expect(check.claims).toEqual([claim("000101", 1000, 0, 1000), claim("000102", 500.5, 200.25, 300.25)])
        expect(check.added).toHaveLength(2)
        expect([check.changed, check.gone, check.same, check.problems]).toEqual([[], [], 0, []])
        expect([check.owedNow, check.owedAfter]).toEqual([0, 1300.25])
    })

    it("tells what's new, what changed with what it was, what's going, and what stays", () => {
        const before = [claim("000101", 1000, 0, 1000), claim("000102", 21088.26, 0, 21088.26), claim("000103", 8.45, 0, 8.45)]
        const check = checkTaxFile(file(row("000101", 1000, 0, 1000), row("000102", 21088.26, 7365, 13723.26), row("000104", 56.7, 0, 56.7)), now(before))
        expect(check.same).toBe(1)
        expect(check.added.map(c => c.claimNumber)).toEqual(["000104"])
        expect(check.gone.map(c => c.claimNumber)).toEqual(["000103"])
        expect(check.changed).toEqual([{
            before: before[1], after: claim("000102", 21088.26, 7365, 13723.26),
            changes: [{ what: "paid", before: 0, after: 7365 }, { what: "remaining", before: 21088.26, after: 13723.26 }],
        }])
        expect([check.owedNow, check.owedAfter]).toEqual([22096.71, 14779.96])
    })

    it("has nothing changed by the same file again", () => {
        const claims = [claim("000101", 1000, 0, 1000), claim("000102", 500.5, 200.25, 300.25)]
        const check = checkTaxFile(file(row("000101", 1000, 0, 1000), row("000102", 500.5, 200.25, 300.25)), now(claims))
        expect([check.added, check.changed, check.gone, check.same]).toEqual([[], [], [], 2])
        expect(check.owedNow).toBe(check.owedAfter)
    })

    it("lists each row with a problem, with its line, its claim's number and what's wrong", () => {
        const check = checkTaxFile(file(row("000101", 1000, 0, 1000), row("000102", 21088.26, 7365, 13723), row(372601708, 56.7, 0, 56.7), row("", 5, 0, 5)), now([]))
        expect(check.problems).toEqual([
            { line: 3, claimNumber: "000102", mistakes: [{ code: "amounts_dont_add_up" }] },
            { line: 4, claimNumber: "372601708", mistakes: [{ code: "number_as_number", detail: "372601708" }] },
            { line: 5, claimNumber: "", mistakes: [{ code: "number_missing" }] },
        ])
        // What a save would send has only the rows that are right, so a save is stopped.
        expect(check.claims.map(c => c.claimNumber)).toEqual(["000101"])
    })

    it("counts the rows left out as paid apart from those left out for their status", () => {
        const check = checkTaxFile(file(
            row("000101", 1000, 0, 1000), row("000102", 50, 50, 0), row("000103", 60, 60, 0),
            row("000104", 70, 0, 70, { 9: "ملغي" }), row("000105", 80, 0, 80, { 9: "ملغي" }), row("000106", 90, 0, 90, { 9: "مسدد" }),
        ), now([]))
        expect(check.claims).toHaveLength(1)
        expect(check.paid).toBe(2)
        expect(check.otherStatuses).toEqual([{ status: "ملغي", rows: 2 }, { status: "مسدد", rows: 1 }])
    })
})

describe("whether the file is this client's", () => {
    const one = (company: unknown) => file(row("000101", 1000, 0, 1000, { 0: company }))

    it("is where it names the client, or the company the client's last file named", () => {
        expect(checkTaxFile(one(ALEF), now([]))).toMatchObject({ company: ALEF, namesClient: true })
        expect(checkTaxFile(one("شركة باء"), now([], { fileCompany: "شركه باء" }))).toMatchObject({ company: "شركة باء", namesClient: true })
    })

    it("isn't where it names another company, or none", () => {
        expect(checkTaxFile(one("شركة باء"), now([]))).toMatchObject({ company: "شركة باء", namesClient: false })
        expect(checkTaxFile(one(UNNAMED_COMPANY), now([]))).toMatchObject({ company: null, namesClient: false })
        expect(checkTaxFile(one(""), now([]))).toMatchObject({ company: null, namesClient: false })
    })
})

describe("what changed of a claim", () => {
    const was = claim("000101", 1000, 0, 1000)

    it("is each amount that differs to the piastre, with what it was and is", () => {
        expect(changesOf(was, claim("000101", 1000, 400, 600))).toEqual([{ what: "paid", before: 0, after: 400 }, { what: "remaining", before: 1000, after: 600 }])
        expect(changesOf(was, claim("000101", 1200.5, 0, 1200.5))).toEqual([{ what: "original", before: 1000, after: 1200.5 }, { what: "remaining", before: 1000, after: 1200.5 }])
        // What a sum leaves behind isn't a change.
        expect(changesOf(claim("000101", 0.3, 0, 0.3), claim("000101", 0.1 + 0.2, 0, 0.1 + 0.2))).toEqual([])
    })

    it("is its last day to pay, and anything else as its details", () => {
        expect(changesOf(was, { ...was, dueDate: "2026-05-31" })).toEqual([{ what: "due", before: "2026-04-30", after: "2026-05-31" }])
        expect(changesOf(was, { ...was, status: "مسدد جزئيًا", paidAmount: 1, remainingAmount: 999 })).toEqual([
            { what: "paid", before: 0, after: 1 }, { what: "remaining", before: 1000, after: 999 }, { what: "details" },
        ])
        expect(changesOf(was, { ...was, item: "إقرار تجاري", periodEnd: null })).toEqual([{ what: "details" }])
    })
})

describe("the day the figures are from, to start with", () => {
    it("is the day in the file's name, or today where it has none, or one after today", () => {
        expect(asOfFor(`مطالبات - ${ALEF} - 2026-11-16.xlsx`, "2026-11-18")).toBe("2026-11-16")
        expect(asOfFor("claims.xlsx", "2026-11-18")).toBe("2026-11-18")
        expect(asOfFor("claims - 2026-11-19.xlsx", "2026-11-18")).toBe("2026-11-18")
    })
})

describe("what a save sends", () => {
    const read = file(row("٠٠٠١٠١", 1000, 0, 1000), row("000102", 500.5, 200.25, 300.25))
    const basis = now([claim("000101", 1000, 0, 1000)], { uploads: 4 })

    it("is the claims the browser read, the count of files it was checked against, the day and the file", () => {
        const upload = uploadOf(basis, read, checkTaxFile(read, basis), { asOf: "2026-11-16", fileName: "claims - 2026-11-16.xlsx", confirmed: false })
        expect(upload).toEqual({
            clientId: "noor", uploads: 4, asOf: "2026-11-16", fileName: "claims - 2026-11-16.xlsx", fileCompany: ALEF, confirmed: false,
            claims: [claim("000101", 1000, 0, 1000), claim("000102", 500.5, 200.25, 300.25)],
        })
        // And it's what the server takes.
        expect(sentUpload(JSON.parse(JSON.stringify(upload)))).toEqual({ upload })
    })
})

describe("asking the server", () => {
    afterEach(() => vi.unstubAllGlobals())
    const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))

    it("reads what a file is checked against, for the client", async () => {
        const basis = now([claim("000101", 1000, 0, 1000)])
        const fetched = answer(200, { success: true, data: basis })
        vi.stubGlobal("fetch", fetched)
        expect(await readClaimsNow("a b")).toEqual({ now: basis })
        expect(String((fetched.mock.calls[0] as unknown[])[0])).toBe(`${TAX_UPLOAD_URL}?clientId=a+b`)
    })

    it("says why it couldn't, by the server's code and words", async () => {
        vi.stubGlobal("fetch", answer(400, { success: false, error: "This client is archived. Restore it on the Clients page first.", code: "CLIENT_ARCHIVED" }))
        expect(await readClaimsNow("old")).toEqual({ refused: { code: "CLIENT_ARCHIVED", message: "This client is archived. Restore it on the Clients page first." } })
    })

    it("saves once, and gives what the server did or why it refused", async () => {
        const upload = uploadOf(now([]), file(row("000101", 1000, 0, 1000)), checkTaxFile(file(row("000101", 1000, 0, 1000)), now([])), { asOf: "2026-11-16", fileName: "f.xlsx", confirmed: true })
        const sent = answer(200, { success: true, data: { added: 1, changed: 0, gone: 0, claims: 1, uploads: 1 } })
        vi.stubGlobal("fetch", sent)
        expect(await saveUpload(upload)).toEqual({ saved: { added: 1, changed: 0, gone: 0, claims: 1, uploads: 1 } })
        expect(sent).toHaveBeenCalledTimes(1)
        const [url, init] = sent.mock.calls[0] as unknown as [string, RequestInit]
        expect([url, init.method, JSON.parse(String(init.body))]).toEqual([TAX_UPLOAD_URL, "POST", upload])

        vi.stubGlobal("fetch", answer(409, { success: false, error: "This client's claims changed since the file was checked. Check the file again.", code: "TAX_CLAIMS_CHANGED" }))
        expect(await saveUpload(upload)).toMatchObject({ refused: { code: "TAX_CLAIMS_CHANGED" } })
        vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline") }))
        expect(await saveUpload(upload)).toEqual({ refused: { code: null, message: null } })
    })
})
