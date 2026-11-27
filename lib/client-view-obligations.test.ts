import { describe, it, expect, vi, beforeAll } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * View obligations on a client's page (LATER_CHANGES_PLAN.md §7.7, 7b;
 * DESIGN.md §5.5, An obligation's client), in place of an Obligations section:
 * beside View tasks on the end of its details' heading, opening the
 * Obligations list filtered to the client, for whoever may see obligations.
 */

const state = { locale: "en" as "en" | "ar", can: [] as string[] }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
const ADMIN = { id: "a1", role: "ADMIN", companyId: "c1" }
// Made up.
const CLIENT = { id: "client-1", name: "Nile Foods", nameAr: null, ownerName: "Made-up owner", ownerNameAr: null, mobileNumber: "01000000001", locationName: "Made-up street", locationLink: null, locations: [], archivedAt: null }

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: ADMIN }, status: "authenticated", update: async () => null }) }))
vi.mock("@/lib/useCan", () => ({
    useViewer: () => ADMIN,
    useCan: () => ({ can: (p: string) => state.can.includes(p), companyWide: () => true, scope: () => "COMPANY", canFor: () => true }),
}))
vi.mock("@/lib/features/useFeatures", () => ({ useFeatures: () => ({ has: () => false }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: (key: string) => words()[key] ?? key }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("next/navigation", () => ({
    useParams: () => ({ id: "client-1" }),
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
    usePathname: () => "/dashboard/clients/client-1",
}))
vi.mock("swr", () => ({
    default: (key: unknown) => ({
        data: key === "/api/clients?id=client-1" ? { data: CLIENT } : undefined,
        error: undefined, isLoading: false, isValidating: false, mutate: async () => {},
    }),
    useSWRConfig: () => ({ mutate: () => {} }),
}))
vi.mock("@/components/locations/LocationsList", () => ({ default: () => null }))
vi.mock("@/components/charges/ChargesList", () => ({ default: () => null }))
vi.mock("@/components/records/RecordsList", () => ({ default: () => null }))
vi.mock("@/components/records/SectionsCard", () => ({ default: () => null }))

let ClientPage: () => ReactElement
beforeAll(async () => {
    ClientPage = (await import("@/app/(dashboard)/dashboard/clients/[id]/page")).default
})
const page = (can: string[], locale: "en" | "ar" = "en") => {
    Object.assign(state, { can, locale })
    return renderToStaticMarkup(h(ClientPage))
}
/** The end of the details' heading: its links, in order. */
const links = (html: string) => {
    const head = html.match(/<div class="ui-card-head"><h2 class="ui-card-title">[^<]*<\/h2>([\s\S]*?)<\/div>/)?.[1] ?? ""
    return [...head.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m => [m[1], m[2]])
}

describe("View obligations on a client's page", () => {
    it("is beside View tasks, opening the Obligations list filtered to the client, for whoever may see obligations", () => {
        expect(links(page(["clients.view", "obligations.view"]))).toEqual([
            ["/dashboard/tasks?clientId=client-1", "View tasks"],
            ["/dashboard/obligations?clientId=client-1", "View obligations"],
        ])
    })

    it("isn't offered to someone who sees only their own obligations, whose list the client doesn't narrow", () => {
        const html = page(["clients.view"])
        expect(links(html)).toEqual([["/dashboard/tasks?clientId=client-1", "View tasks"]])
        expect(html).not.toContain("/dashboard/obligations")
    })

    it("is in Arabic too", () => {
        expect(links(page(["clients.view", "obligations.view"], "ar"))).toEqual([
            ["/dashboard/tasks?clientId=client-1", "عرض المهام"],
            ["/dashboard/obligations?clientId=client-1", "عرض الالتزامات"],
        ])
    })

    it("has its words in both languages", () => {
        expect(en.clients_view_obligations).toBe("View obligations")
        expect(ar.clients_view_obligations).toBe("عرض الالتزامات")
    })
})
