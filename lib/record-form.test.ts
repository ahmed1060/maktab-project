import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * Editing a record from the Records page, where the form fetches the record's
 * client's sections to move it to another (CLIENTS_PLAN.md §0.2). When that
 * request failed, the list fell back to the record's own section alone: the
 * form looked loaded and saved, with no way to move the record and nothing
 * to say why (Codex on #82). It now says the sections didn't load, with Try
 * again, as adding a record there does.
 */

const sections = { failing: true }
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
// Drawn in place: the real one waits to be mounted in a browser.
vi.mock("@/components/ui/Dialog", () => ({
    Dialog: ({ title, children, actions }: any) => h("div", null, h("h2", null, title), children, actions),
    DialogActions: ({ children }: any) => h("div", null, children),
}))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        if (key?.startsWith("/api/records/sections?vendorId=v1")) {
            return sections.failing
                ? { data: undefined, error: new Error("Request failed"), isValidating: false, mutate: async () => {} }
                : { data: { data: { sections: [{ id: "s1", title: "Licences", records: 1 }, { id: "s2", title: "Contracts", records: 0 }] } }, error: undefined, isValidating: false, mutate: async () => {} }
        }
        return { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
    },
}))

const record = {
    id: "r1", content: "Trade licence", files: [], expiryDate: null, expiry: null, reminderDays: null,
    createdAt: "2026-10-01T09:00:00Z", lastEditedAt: null, createdBy: null, lastEditedBy: null,
    createdBySuperAdmin: false, lastEditedBySuperAdmin: false,
    section: { id: "s1", title: "Licences" }, client: { id: "v1", name: "Acme" },
}

async function editOnRecordsPage() {
    const { default: RecordForm } = await import("@/components/records/RecordForm")
    // As the Records page opens it: the record's client, and no sections handed in.
    return renderToStaticMarkup(h(RecordForm, { open: true, onClose: () => {}, vendorId: "v1", record, onSaved: () => {} }))
}

describe("editing a record from the Records page", () => {
    it("says when its client's sections didn't load, with Try again, and waits for them", async () => {
        sections.failing = true
        const html = await editOnRecordsPage()
        expect(html).toContain("records_sections_failed")
        expect(html).toContain("try_again")
        expect(html).toMatch(/<button type="submit"[^>]*disabled=""/)
    })

    it("offers the client's other sections once they load", async () => {
        sections.failing = false
        const html = await editOnRecordsPage()
        expect(html).not.toContain("records_sections_failed")
        expect(html).toContain(">Contracts</option>")
        expect(html).not.toMatch(/<button type="submit"[^>]*disabled=""/)
    })

    it("closes, as do viewing and deleting one, when a Super Admin picks another company", () => {
        // Each holds a record of the company before, which Save or Delete would still act on.
        const LIST = readFileSync("components/records/RecordsList.tsx", "utf8")
        expect(LIST).toContain("const scope = vendorId ?? selectedCompanyId")
        expect(LIST).toContain("useAdjustOnChange([scope], () => { setViewing(null); setEditing(null); setDeleting(null) })")
    })

    it("is opened with no sections, for the form to load them", () => {
        const LIST = readFileSync("components/records/RecordsList.tsx", "utf8")
        expect(LIST).not.toContain("editSections")
        expect(LIST).toMatch(/vendorId=\{editing\?\.client\.id \?\? vendorId\}[\s\S]*?sections=\{vendorId \? sections : undefined\}\s*record=\{editing\}/)
    })
})
