import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import type { FeedRow } from "@/lib/requests/kinds"
import { withGrants } from "@/lib/permissions/test-actors"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * The Requests page with whose each request is in the page's language
 * (LATER_CHANGES_PLAN.md §3.1, step 8l; PR 424): every kind's, in its table,
 * its cards and the buttons that decide it; the person a role request is for;
 * and the questions and dialogs that name them. Each name is in the page's
 * language, or in the one it has while it has only one.
 */

// The first import of the page and the feed takes a while.
vi.setConfig({ testTimeout: 60_000 })

const ui = { locale: "en" as "en" | "ar" }
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
    useSearchParams: () => new URLSearchParams(""),
    usePathname: () => "/dashboard/requests",
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: () => false }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: (k: string) => k }) }))

const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
// Made-up people, as the database keeps them: Mona has an Arabic name, Bob none.
const MONA = { firstName: "Mona", lastName: "Adel", firstNameAr: "منى", lastNameAr: "عادل" }
const BOB = { firstName: "Bob", lastName: "Brown", firstNameAr: null, lastNameAr: null }

describe("the feed", () => {
    const asked = new Date("2026-10-29T09:00:00Z")

    it("gives whose each request is in Arabic too, or null for someone with none", async () => {
        const { internalRow } = await import("@/lib/requests/feed")
        const request = (user: object) => ({
            id: "r1", title: "A new chair", details: null, status: "PENDING", companyId: "c1", userId: "e2",
            createdAt: asked, updatedAt: asked, inProgressAt: null, completedAt: null, user: { ...user, teamLeaderId: null },
        })
        expect(internalRow(admin, request(MONA) as never).who).toEqual({ id: "e2", name: "Mona Adel", nameAr: "منى عادل" })
        expect(internalRow(admin, request(BOB) as never).who).toEqual({ id: "e2", name: "Bob Brown", nameAr: null })
    })

    it("gives a flagged check-in's person in Arabic too, and nobody's as no name", async () => {
        const { flaggedRow } = await import("@/lib/requests/feed")
        const punch = (user: object | null) => ({
            id: "k1", companyId: "c1", userId: user ? "e2" : null, status: "FLAGGED", direction: "IN", punchAtLocal: new Date("2026-10-29T09:02:00Z"),
            receivedAt: asked, reviewedAt: null, reviewReason: null, flagReasons: [], checkIn: null, workLocation: null, phone: null,
            user: user && { ...user, teamLeaderId: null },
        })
        expect(flaggedRow(admin, punch(MONA) as never).who).toEqual({ id: "e2", name: "Mona Adel", nameAr: "منى عادل" })
        expect(flaggedRow(admin, punch(null) as never).who).toEqual({ id: "", name: "", nameAr: null })
    })

    it("gives who asked for a role, and whose it would be, in Arabic too", async () => {
        const { roleRow } = await import("@/lib/requests/feed")
        const row = roleRow(admin, {
            id: "r1", companyId: "c1", userId: "e2", requestedById: "h1", status: "PENDING", note: null, decisionNote: null,
            actingUntil: null, createdAt: asked, decidedAt: null, company: { timezone: "Africa/Cairo" },
            user: { ...MONA, teamLeaderId: null, assignedRole: null }, role: { name: "Accountant", builtIn: null },
            requestedBy: BOB, decidedBy: null,
        } as never)
        expect(row.who).toEqual({ id: "h1", name: "Bob Brown", nameAr: null })
        expect(row.role?.person).toEqual({ id: "e2", name: "Mona Adel", nameAr: "منى عادل" })
    })

    it("reads each person's Arabic name for every kind, and builds each person the same way", () => {
        // Each kind's query and row; the three above are read through.
        const source = readFileSync("lib/requests/feed.ts", "utf8")
        const selects = source.match(/firstName: true, lastName: true[^}]*/g) ?? []
        expect(selects.length).toBeGreaterThanOrEqual(11)
        for (const select of selects) expect(select).toContain("firstNameAr: true, lastNameAr: true")
        expect(source).not.toMatch(/who: \{ id: [^,]+, name: /)
        // Salary advances are the twelfth (LATER_CHANGES_PLAN.md §7.5, step 3a, PR 449).
        expect(source.match(/who: personOf\(/g)?.length).toBe(12)
    })
})

describe("the Requests page", () => {
    const row = (fields: Partial<FeedRow> = {}): FeedRow => ({
        kind: "internal", id: "r1", who: { id: "e2", name: "Mona Adel", nameAr: "منى عادل" }, what: "A new chair", detail: null,
        asked: "2026-10-29T09:00:00.000Z", started: null, finished: null, status: "PENDING", sortAt: "2026-10-29T09:00:00.000Z",
        mayDecide: true, mayDelete: false, ...fields,
    })
    const page = async (locale: "en" | "ar", rows: FeedRow[]) => {
        ui.locale = locale
        const { default: RequestsClient } = await import("@/app/(dashboard)/dashboard/requests/RequestsClient")
        return renderToStaticMarkup(h(RequestsClient, {
            rows, total: rows.length, page: 1, totalPages: 1, kinds: ["internal", "role"],
            tabs: { mine: true, review: true }, tab: "review", show: "waiting", superAdmin: false,
        } as never))
    }

    it("names whose each request is in the page's language, in its table, its cards and its buttons", async () => {
        const html = await page("ar", [row()])
        expect(html).toContain("منى عادل")
        expect(html).not.toContain("Mona Adel")
        expect(await page("en", [row()])).toContain("Mona Adel")
        // A day off's buttons that decide it say whose it is, as every kind's but an internal request's do.
        const dayOff = await page("ar", [row({ kind: "dayOff", what: "REGULAR" })])
        expect(dayOff).toMatch(/aria-label="[^"]*منى عادل"/)
        expect(dayOff).not.toContain("Mona Adel")
    })

    it("names someone with no Arabic name in English on an Arabic page", async () => {
        const html = await page("ar", [row({ who: { id: "e3", name: "Bob Brown", nameAr: null } })])
        expect(html).toContain("Bob Brown")
    })

    it("names the person a role request is for in the page's language", async () => {
        const role = row({
            kind: "role", id: "r2", who: { id: "h1", name: "Bob Brown", nameAr: null }, what: "Accountant",
            role: { to: { name: "Accountant", builtIn: null }, now: null, actingUntil: null, person: { id: "e2", name: "Mona Adel", nameAr: "منى عادل" }, decidedBy: null, note: null },
        } as Partial<FeedRow>)
        const html = await page("ar", [role])
        expect(html).toContain("منى عادل")
        expect(html).not.toContain("Mona Adel")
    })

    it("names them in the page's language in its questions and dialogs", () => {
        // Each opens from a click, so its code is read: no name in them is the English alone.
        for (const file of ["RequestsClient.tsx", "DayOffDialogs.tsx", "AttendanceDialogs.tsx"]) {
            const source = readFileSync(`app/(dashboard)/dashboard/requests/${file}`, "utf8")
            expect(source, file).not.toMatch(/\.who\.name\b/)
            expect(source, file).not.toMatch(/\.person\.name\b/)
        }
    })
})
