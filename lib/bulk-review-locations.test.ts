import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * The bulk upload's review screen (CLIENTS_PLAN.md §2.7): each row's client
 * and location, on the building blocks (DESIGN.md §5.3, §10), with what's
 * wrong with a row's location said beside its select, and tied to it.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
// Drawn here: no portal in a page rendered to a string.
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async importOriginal => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (children: unknown) => children }))

const places = [
    { id: "hq", name: "Nasr City", clientId: "k1", isHq: true, needsPin: false },
    { id: "port", name: "Port gate", clientId: null, isHq: false, needsPin: false },
]
const row = {
    title: "Fix the door", description: "The side door sticks", assigneeIds: [], deadline: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    difficulty: 1, clientId: "k1", locationId: null, validationErrors: { location: ["bulk_location_other_client"] }, isInvalid: true,
    // As the upload's parser fills them in.
    usernamesRaw: "e1", resolvedIds: ["e1"], resolvedNames: ["Ehab One"], unresolvedUsernames: [],
}

async function review() {
    const { default: BulkTaskReviewModal } = await import("@/components/BulkTaskReviewModal")
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(BulkTaskReviewModal, {
            isOpen: true, onClose: () => {}, bulkTasks: [row], setBulkTasks: () => {}, users: [], clients: [{ id: "k1", name: "Acme" }],
            places, revalidateRow: (r: unknown) => r, isSubmitting: false, setIsSubmitting: () => {},
        } as any))
    } finally {
        vi.unstubAllGlobals()
    }
}

describe("the bulk upload's review screen", () => {
    it("ties what's wrong with a row's location to its select, for a screen reader to read with it", async () => {
        const html = await review()
        const select = html.match(/<select[^>]*aria-invalid="true"[^>]*>/)?.[0] ?? ""
        const note = select.match(/aria-describedby="([^"]+)"/)?.[1]
        expect(note).toBeTruthy()
        expect(html).toMatch(new RegExp(`id="${note}"[^>]*>[^<]*bulk_location_other_client`))
    })

    it("spaces a row's client and location with the design's tokens (DESIGN.md §10)", async () => {
        const html = await review()
        const group = html.match(/<div class="ui-field-group"[^>]*>/)?.[0] ?? ""
        expect(group).not.toMatch(/gap:\s*[\d.]+(rem|px)/)
    })
})
