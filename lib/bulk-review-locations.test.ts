import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * The bulk upload's review screen (CLIENTS_PLAN.md §2.7): each row's client
 * and location, on the building blocks (DESIGN.md §5.3, §10), with what's
 * wrong with a row's location said under its select, and tied to it. Since
 * PR 212 they're among the row's fields, which its Edit opens.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))

const places = [
    { id: "hq", name: "Nasr City", clientId: "k1", isHq: true, needsPin: false },
    { id: "port", name: "Port gate", clientId: null, isHq: false, needsPin: false },
    { id: "dock", name: "Dock 4", clientId: "k2", isHq: false, needsPin: false },
]
// Another client's location, as the upload's parser can give a row.
const row = {
    line: 3, title: "Fix the door", description: "The side door sticks", clientId: "k1", unknownClient: "", locationId: "dock", locationText: "",
    assigneeIds: ["e1"], unknownPeople: [], deadline: new Date(Date.now() + 5 * 86_400_000).toISOString(), unreadDeadline: "", difficulty: 1,
}

async function fields() {
    const { BulkRowFields } = await import("@/components/BulkTaskReviewModal")
    return renderToStaticMarkup(h(BulkRowFields, {
        row, onChange: () => {}, people: [], onRetryPeople: () => {}, retryingPeople: false, clients: [{ id: "k1", name: "Acme" }], places, now: Date.now(),
    }))
}

describe("the bulk upload's review screen", () => {
    it("ties what's wrong with a row's location to its select, for a screen reader to read with it", async () => {
        const html = await fields()
        const select = html.match(/<select[^>]*aria-invalid="true"[^>]*>/)?.[0] ?? ""
        const note = select.match(/aria-describedby="([^"]+)"/)?.[1]
        expect(note).toBeTruthy()
        expect(html).toMatch(new RegExp(`id="${note}"[^>]*>[^<]*bulk_location_other_client`))
    })

    it("spaces a row's client and location with the design's tokens (DESIGN.md §10)", async () => {
        const html = await fields()
        const group = html.match(/<div class="ui-field-group"[^>]*>/)?.[0] ?? ""
        expect(group).toBe('<div class="ui-field-group">')
    })
})
