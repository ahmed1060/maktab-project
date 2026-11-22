import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { taxClaimsUrl, type TaxPosition } from "./tax-claims"
import { scopedKey } from "./swr-scoped"

/**
 * Upload from the tax portal, on a client's Tax position (CLIENT_PORTAL_PLAN.md
 * §4.1, §15; DESIGN.md §5.5, Uploading the tax portal's file; PR 316): who
 * has the button, and how the screen behind it is put together. What it
 * shows of a file is in lib/tax-upload-check.test.ts, what a file would
 * change in lib/tax-check.test.ts, and the whole of it in the browser flows.
 */

const state = { locale: "en", data: undefined as TaxPosition | undefined }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => ((state.locale === "ar" ? ar : en) as Record<string, string>)[key] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("swr", () => ({
    default: ([url, scope]: [string, string]) => ({ error: undefined, isLoading: false, isValidating: false, mutate: async () => {}, data: state.data === undefined ? undefined : { scope, url, body: { data: state.data } } }),
}))

let Section: (props: { clientId: string; manages?: boolean }) => ReactElement
beforeAll(async () => {
    Section = (await import("@/components/tax/TaxPosition")).default
}, 60_000)
beforeEach(() => {
    state.locale = "en"
    state.data = undefined
})

const POSITION: TaxPosition = {
    client: { id: "noor", name: "Al Noor", archived: false }, today: "2026-11-18",
    position: { asOf: "2026-10-14", uploadedOn: "2026-10-15", uploadedBy: "Amal One" },
    totals: { original: 100, paid: 0, remaining: 100, open: 1, late: 0 },
    claims: [{
        id: "n1", claimNumber: "000101", item: "إقرار ضريبة الدخل", taxType: "دخل", registrationType: null, originalAmount: 100, paidAmount: 0, remainingAmount: 100,
        currency: "جنيه مصري", status: "في انتظار السداد", periodStart: "2026-01-01", periodEnd: "2026-03-31", dueDate: "2026-12-31", daysLate: 0,
    }],
    total: 1, totalPages: 1,
    accountant: { person: null, reach: "none" },
}
const NONE: TaxPosition = { ...POSITION, position: null, totals: { original: 0, paid: 0, remaining: 0, open: 0, late: 0 }, claims: [], total: 0, totalPages: 0 }
const render = (manages?: boolean) => renderToStaticMarkup(h(Section, { clientId: "noor", manages }))
const button = (html: string, label: string) => new RegExp(`<div class="ui-section-head">.*?<button[^>]*>(<[^>]+>)*${label}`).test(html)

describe("Upload from the tax portal", () => {
    it("is on the section's heading for whoever may update tax positions, before the first file too", () => {
        state.data = POSITION
        expect(button(render(true), "Upload from the tax portal")).toBe(true)
        state.data = NONE
        const before = render(true)
        expect(button(before, "Upload from the tax portal")).toBe(true)
        expect(before).toContain("No tax position yet")
    })

    it("isn't there for someone who only sees the tax position", () => {
        state.data = POSITION
        expect(render(false)).not.toContain("Upload from the tax portal")
        expect(render()).not.toContain("Upload from the tax portal")
        expect(render(false)).toContain("000101")
    })

    it("isn't on an archived client, whose figures stay as they were", () => {
        state.data = { ...POSITION, client: { ...POSITION.client, archived: true } }
        const html = render(true)
        expect(html).not.toContain("Upload from the tax portal")
        expect(html).toContain("000101")
    })

    it("isn't there until the section has loaded", () => {
        expect(render(true)).not.toContain("Upload from the tax portal")
    })

    it("takes one .xlsx file, from a picker a keyboard never lands on", () => {
        state.data = POSITION
        const input = render(true).match(/<input[^>]*type="file"[^>]*>/)?.[0] ?? ""
        expect(input).toContain(`accept=".xlsx"`)
        expect(input).not.toContain("multiple")
        expect(input).toContain(`tabindex="-1"`)
        expect(input).toContain(`aria-hidden="true"`)
    })

    it("is said in Arabic", () => {
        state.locale = "ar"
        state.data = POSITION
        expect(button(render(true), "رفع ملف البوابة")).toBe(true)
    })

    it("is given by the client's page to whoever holds tax.manage", () => {
        const page = readFileSync("app/(dashboard)/dashboard/clients/[id]/page.tsx", "utf8")
        expect(page).toContain(`<TaxPosition key={id} clientId={id} manages={can('tax.manage')} picks={can('clients.edit')} editsProfile={person => editsProfile({ can, viewer, person })} />`)
    })

    it("is back at once on a client restored from its page: its tax position is read again, not kept as archived", () => {
        const page = readFileSync("app/(dashboard)/dashboard/clients/[id]/page.tsx", "utf8")
        const restoring = page.slice(page.indexOf("const restore = async"), page.indexOf("setRestoring(false)"))
        expect(restoring).toContain("showToast(t('clients_restored_done'), 'success')")
        // This client's claims alone, whichever of its pages is on screen (lib/swr-scoped.ts: the address, then the client).
        expect(restoring).toContain("void mutate(key => Array.isArray(key) && key[1] === id && typeof key[0] === 'string' && key[0].startsWith('/api/tax-claims?'))")
        expect(taxClaimsUrl("noor", false, 1).startsWith("/api/tax-claims?")).toBe(true)
        expect(scopedKey(taxClaimsUrl("noor", true, 2), "noor")?.[1]).toBe("noor")
    })
})

describe("the screen behind it", () => {
    const screen = readFileSync("components/tax/TaxUpload.tsx", "utf8")
    const at = (mark: string) => {
        const index = screen.indexOf(mark)
        expect(index, mark).toBeGreaterThan(-1)
        return index
    }

    it("refuses a file over 2 MB before reading it, and reads it once what it's checked against has loaded", () => {
        expect(at("picked.size > TAX_FILE_MAX_BYTES")).toBeLessThan(at("readClaimsNow(clientId)"))
        expect(at("readClaimsNow(clientId)")).toBeLessThan(at("readTaxFile(await picked.arrayBuffer())"))
    })

    it("fetches the file's reader when a file is picked, not with the page", () => {
        expect(screen).toContain(`await import('@/lib/tax-file-read')`)
        expect(screen).not.toMatch(/^import \{[^}]*\} from '@\/lib\/tax-file-read'/m)
        expect(screen).not.toContain("exceljs")
    })

    it("lets the same file be picked again", () => {
        expect(screen).toMatch(/\.value = ''/)
    })

    it("asks first where the file's company isn't the client's, with a danger button", () => {
        expect(screen.match(/<ConfirmDialog/g)).toHaveLength(1)
        const asked = screen.slice(at("<ConfirmDialog"), screen.indexOf("/>", at("<ConfirmDialog")))
        expect(asked).toContain("danger")
        expect(asked).toContain("tax_upload_confirm_yes")
        expect(at("!check.namesClient && !confirmed")).toBeLessThan(at("saveUpload("))
    })

    it("says each refusal in its own words, and checks the file again where the claims changed", () => {
        for (const code of ["TAX_CLAIMS_CHANGED", "TAX_FILE_OTHER_COMPANY", "TAX_DAY_AFTER_TODAY", "CLIENT_ARCHIVED", "TAX_UPLOAD_INVALID", "TAX_TOO_MANY_CLAIMS"]) expect(screen, code).toContain(`'${code}'`)
        const changed = screen.slice(at("'TAX_CLAIMS_CHANGED'"))
        expect(changed.indexOf("readClaimsNow(clientId)")).toBeGreaterThan(-1)
        expect(screen).toContain("tax_upload_changed_meanwhile")
    })

    it("says in the reader's own language that the client's claims couldn't be read, or that it's archived", () => {
        expect(screen).toContain("t(refused.code === 'CLIENT_ARCHIVED' ? 'tax_upload_archived' : 'tax_upload_unchecked')")
        expect(screen).not.toContain("refused.message")
    })

    it("calls a file's reading off when it's closed, and shows only the file picked last", () => {
        // Closed while another file is read, that file's check screen never opens.
        const closing = screen.slice(at("const close = () => {"), at("/** What a file comes to"))
        expect(closing).toMatch(/if \(saving\) return\s+reads\.current \+= 1\s+setReading\(false\)/)
        const picking = screen.slice(at("const pick = async"), at("const save = async"))
        expect(picking).toContain("const mine = ++reads.current")
        expect(picking.indexOf("await read(picked)")).toBeGreaterThan(picking.indexOf("const mine = ++reads.current"))
        expect(picking.indexOf("if (reads.current !== mine) return")).toBeGreaterThan(picking.indexOf("await read(picked)"))
        expect(picking.indexOf("setStage(next)")).toBeGreaterThan(picking.indexOf("if (reads.current !== mine) return"))
        // A reading called off doesn't end the busy state of the one that took its place.
        expect(picking).toContain("if (reads.current === mine) setReading(false)")
    })

    it("says in the toast, once saved, whether the client's people were emailed (§4.4, PR 351)", () => {
        const saved = screen.slice(at("if ('saved' in result)"), at("onSaved()"))
        expect(saved).toContain("emailSaid(t, locale, email)")
        expect(saved).toMatch(/showToast\(\[saved, emailSaid\(t, locale, email\)\]\.filter\(Boolean\)\.join\(' '\), 'success'\)/)
    })

    it("can't be closed while it's sent, and reads the section again once it's saved", () => {
        expect(screen).toMatch(/if \(saving\) return/)
        expect(at("onSaved()")).toBeGreaterThan(at("saveUpload("))
        expect(readFileSync("components/tax/TaxPosition.tsx", "utf8")).toContain("onSaved={() => { void mutate() }}")
    })

    it("has every word it says in both languages", () => {
        const sources = [screen, readFileSync("components/tax/TaxUploadCheck.tsx", "utf8")].join("\n")
        const keys = new Set([...sources.matchAll(/['"`](tax_(?:upload|mistake)_[a-z_]+)['"`]/g)].map(m => m[1]).filter(key => !key.endsWith("_")))
        expect(keys.size).toBeGreaterThan(40)
        for (const key of keys) {
            expect((en as Record<string, string>)[key], `en ${key}`).toBeTruthy()
            expect((ar as Record<string, string>)[key], `ar ${key}`).toBeTruthy()
        }
        // No command in the masculine, and no "we", in what it says.
        const said = [...keys].map(key => (ar as Record<string, string>)[key]).join(" ")
        expect(said).not.toMatch(/(^|\s)(اختر|اضغط|راجع|تأكد|احفظ|ارفع|حاول)(\s|$)/)
    })
})
