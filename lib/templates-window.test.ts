import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { dateTimeText } from "./calendar-text"

/**
 * The templates for the bulk upload of tasks (DESIGN.md §5.5, "A file that
 * replaces one"), which the Super Admin keeps, on the building blocks: the
 * English and the Arabic each a section of its own, the one there now as a
 * saved file, the file picker for one workbook, and Upload once one is
 * picked. It was a window of its own making, with a national flag drawn
 * beside each, a folder emoji on its picker and its words in English.
 */

const state = {
    locale: "en" as "en" | "ar",
    company: null as string | null,
    status: undefined as unknown,
}
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.company }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => ({ default: (key: string | null) => ({ data: key ? state.status : undefined, error: undefined, isValidating: false, mutate: async () => {} }) }))
beforeEach(() => { state.locale = "en"; state.company = null; state.status = undefined })
afterEach(() => { vi.unstubAllGlobals() })

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const SRC = () => readFileSync("components/ManageTemplatesModal.tsx", "utf8")
const PAGE = () => readFileSync("app/(dashboard)/dashboard/tasks/new/page.tsx", "utf8")
const AT = "2026-11-05T12:30:00.000Z"

async function window(open = true) {
    const { default: ManageTemplatesModal } = await import("@/components/ManageTemplatesModal")
    // Its portal is a stand-in's here, which still asks where it goes.
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(ManageTemplatesModal, { isOpen: open, onClose: () => {} }))
    } finally {
        vi.unstubAllGlobals()
    }
}
/** A template's section, by its heading. */
function section(html: string, heading: string): string {
    const at = html.indexOf(`>${esc(heading)}</h3>`)
    expect(at, `no section headed ${heading}`).toBeGreaterThan(-1)
    return html.slice(html.lastIndexOf("<section", at), html.indexOf("</section>", at) + 10)
}

describe("the templates window", () => {
    it("is the building blocks' dialog, under its name in sentence case", async () => {
        expect(await window(false)).toBe("")
        const html = await window()
        expect(html).toContain(`class="ui-dialog-title">${esc(en.manage_templates)}</h2>`)
        expect(en.manage_templates).toBe("Manage templates")
        // Nothing of the old window's own making.
        expect(SRC()).not.toMatch(/modal-overlay|modal-content|modal-header|className="btn|style=\{\{|createPortal|spinner-small|<svg|#[0-9a-fA-F]{3,6}\b|as any|\|\| '/)
        expect(SRC()).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
    })

    it("has a section for each template, the English then the Arabic, under its heading", async () => {
        const html = await window()
        expect(section(html, en.template_en_title)).toContain('<section aria-labelledby="')
        expect(html.indexOf(esc(en.template_en_title))).toBeLessThan(html.indexOf(esc(en.template_ar_title)))
    })

    it("offers the file picker for one workbook in each, with what uploading it replaces", async () => {
        for (const heading of [en.template_en_title, en.template_ar_title]) {
            const part = section(await window(), heading)
            expect(part).toContain(`${esc(en.template_choose)}</button>`)
            expect(part).toContain(`<span class="ui-hint">${esc(en.template_hint)}</span>`)
            expect(part).toMatch(/<input type="file" accept="\.xlsx"/)
            expect(part).not.toMatch(/<input[^>]*multiple/)
            // Nothing picked, nothing to upload.
            expect(part).not.toContain(`>${esc(en.template_upload)}<`)
        }
    })

    it("shows, in the All companies view, the one there now as a saved file and when it was last uploaded", async () => {
        state.status = { data: { en: { exists: true, updatedAt: AT }, ar: { exists: false, updatedAt: null } } }
        const html = await window()
        const english = section(html, en.template_en_title)
        expect(english).toContain('href="/api/templates/raw?locale=en" target="_blank" rel="noopener noreferrer" class="ui-file-open"')
        expect(english).toContain('<span class="ui-file-name">template_en.xlsx</span>')
        expect(english).toContain(esc(en.template_last_updated.replace("{date}", dateTimeText(AT, "en")!)))
        const arabic = section(html, en.template_ar_title)
        expect(arabic).not.toContain("ui-file-open")
        expect(arabic).toContain(esc(en.template_not_uploaded_yet))
        // Its download is a company's: there's none in this view.
        expect(html).not.toContain(esc(en.download_current_template))
    })

    it("shows, in a company's view, where to see the ones there now, and downloads that company's template", async () => {
        state.company = "c 1"
        state.status = { data: { en: { exists: true, updatedAt: AT } } }
        const html = await window()
        expect(html).not.toContain("ui-file-open")
        expect(html).toContain(esc(en.template_view_all_companies_only))
        const link = html.match(/<a[^>]*\/api\/templates\/download[^>]*>/)?.[0] ?? ""
        expect(link).toContain('href="/api/templates/download?locale=en&amp;companyId=c%201"')
        expect(link).toContain('target="_blank"')
        expect(html).toContain(`${esc(en.download_current_template)}</a>`)
    })

    it("closes with Close, a secondary button, its download beside it", async () => {
        const html = await window()
        const actions = html.slice(html.indexOf('class="ui-dialog-actions"'))
        expect(actions).toContain(`<button type="button" class="ui-btn ui-btn-secondary">${esc(en.close)}</button>`)
        expect(actions).not.toContain("ui-btn-primary")
        expect(html).not.toContain(`>${esc(en.cancel)}<`)
    })

    it("is in Arabic in Arabic", async () => {
        state.locale = "ar"
        state.status = { data: { en: { exists: true, updatedAt: AT }, ar: { exists: true, updatedAt: AT } } }
        const html = await window()
        expect(html).toContain(`class="ui-dialog-title">${esc(ar.manage_templates)}</h2>`)
        expect(section(html, ar.template_ar_title)).toContain(esc(ar.template_last_updated.replace("{date}", dateTimeText(AT, "ar")!)))
    })
})

describe("uploading a template", () => {
    it("takes an Excel workbook alone, by its name", async () => {
        const { isWorkbook } = await import("@/lib/bulk-templates")
        expect(isWorkbook("tasks.xlsx")).toBe(true)
        expect(isWorkbook("TASKS.XLSX")).toBe(true)
        for (const name of ["tasks.xls", "tasks.csv", "tasks.xlsx.exe", "xlsx", ""]) expect(isWorkbook(name), name).toBe(false)
    })

    it("sends the file and its language, and says whether it was taken", async () => {
        const { uploadTemplate } = await import("@/lib/bulk-templates")
        const sent: { url: string; body: FormData }[] = []
        vi.stubGlobal("fetch", async (url: string, init: { method: string; body: FormData }) => {
            sent.push({ url, body: init.body })
            return { ok: true } as Response
        })
        const file = new File(["x"], "tasks.xlsx")
        expect(await uploadTemplate(file, "ar")).toBe(true)
        expect(sent[0].url).toBe("/api/templates/upload")
        expect(sent[0].body.get("locale")).toBe("ar")
        expect((sent[0].body.get("file") as File).name).toBe("tasks.xlsx")
        vi.stubGlobal("fetch", async () => ({ ok: false }) as Response)
        expect(await uploadTemplate(file, "en")).toBe(false)
        vi.stubGlobal("fetch", async () => { throw new Error("offline") })
        expect(await uploadTemplate(file, "en")).toBe(false)
    })

    it("is said under the picker when it's of another kind or isn't taken, and with a toast once it is", () => {
        const src = SRC()
        expect(src).toContain("if (!isWorkbook(picked.name)) return setError(t('template_not_xlsx'))")
        expect(src).toContain("setError(t('template_upload_failed'))")
        expect(src).toContain("showToast(t(locale === 'en' ? 'template_en_updated' : 'template_ar_updated'), 'success')")
        expect(src).toContain('<p className="ui-error" role="alert">{error}</p>')
        // While it's sent, the picker is off, and a line under it says so.
        expect(src).toContain("disabled={sending}")
        expect(src).toContain('{sending && <p className="ui-hint" role="status">{t(\'template_uploading\')}</p>}')
    })

    // The browser flows found the one there now left as it was after an
    // upload: the status wasn't always asked for again. It's shown as
    // uploaded at once, then as the store says.
    it("shows the one uploaded as the one there now at once, then as the store says", () => {
        expect(SRC()).toContain("mutate(current => ({ data: { ...current?.data, [locale]: { exists: true, updatedAt: new Date().toISOString() } } }), { revalidate: true })")
        expect(SRC()).toContain("onUploaded={() => uploaded('en')}")
        expect(SRC()).toContain("onUploaded={() => uploaded('ar')}")
    })
})

describe("Create task, for the Super Admin", () => {
    it("opens the templates window from a button named for it", () => {
        expect(PAGE()).toContain("? <Button icon={FileXlsIcon} onClick={() => setIsManageTemplatesOpen(true)}>{t('manage_templates')}</Button>")
    })
})

describe("its words", () => {
    const KEYS = ["manage_templates", "template_en_title", "template_ar_title", "template_choose", "template_hint", "template_upload", "template_uploading",
        "template_en_updated", "template_ar_updated", "template_not_xlsx", "template_upload_failed", "template_last_updated", "template_not_uploaded_yet",
        "template_view_all_companies_only", "download_current_template"] as const

    it("are in both languages, in sentence case, and the Arabic commands nothing in the masculine", () => {
        for (const key of KEYS) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            expect(en[key], key).not.toMatch(/\b(Manage Templates|Current Template|Choose File|English Template|Arabic Template)\b/)
            expect(ar[key], key).not.toMatch(/(^|\s)(اختر|ارفع|حمّل|حمل|أدخل)(\s|$)/)
        }
        expect(en.template_last_updated).toContain("{date}")
        expect(ar.template_last_updated).toContain("{date}")
    })

    it("no longer keep the old window's own", () => {
        for (const key of ["upload_en_template", "upload_ar_template", "view_current_template", "choose_file", "select_company_prompt"]) {
            expect(en, key).not.toHaveProperty(key)
            expect(ar, key).not.toHaveProperty(key)
        }
    })
})
