import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { state as harness, prismaMock, url, as } from "./permissions/employee-access.harness"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { modulesFrom } from "./modules"
import { sideBarFor, type SideBarViewer } from "./side-bar"
import { permissionsOf } from "./useCan"
import { withGrants } from "./permissions/test-actors"
import { stripComments } from "./strip-comments"
import { WAITING_FOR_REVIEW_KEY } from "./requests/kinds"

/**
 * Requests in the side bar carries how many wait on this person under the
 * Requests page's To review tab (DESIGN.md §5.1): the list the page opens on,
 * counted as it counts it, heard with the item's name, and asked again as
 * the person moves around and decides. It replaces the top bar's button for
 * name changes alone.
 */

const ui = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("next-auth", () => ({ getServerSession: async () => harness.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
const asked: { v: any; companyId: string | null }[] = []
vi.mock("@/lib/requests/feed", () => ({ waitingForReview: async (v: unknown, companyId: string | null) => { asked.push({ v, companyId }); return 3 } }))
// The company the Super Admin is looking at, as picking one writes it (context/CompanyContext.tsx).
const jar: { scope?: string } = {}
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name === "scopedCompanyId" && jar.scope !== undefined ? { value: jar.scope } : undefined) }) }))

beforeEach(() => { asked.length = 0; delete jar.scope })

describe("the count's own address", () => {
    const get = async () => (await import("@/app/api/requests/waiting/route")).GET(new Request(url(WAITING_FOR_REVIEW_KEY)))

    it("is the Requests page's", () => {
        expect(WAITING_FOR_REVIEW_KEY).toBe("/api/requests/waiting")
    })

    it("answers how many wait on whoever is signed in, counted by the feed the page reads", async () => {
        as("admin")
        const res = await get()
        expect(res.status).toBe(200)
        expect((await res.json()).data).toEqual({ count: 3 })
        expect(asked).toHaveLength(1)
        expect(asked[0].v.id).toBe(harness.session.user.id)
        expect(asked[0].companyId).toBeNull()
    })

    it("counts the company the Super Admin is looking at, as the page opens on it, and every company's when none", async () => {
        as("superAdmin")
        jar.scope = "c2"
        await get()
        jar.scope = "ALL"
        await get()
        delete jar.scope
        await get()
        expect(asked.map(a => a.companyId)).toEqual(["c2", null, null])
    })

    it("counts no other company for anyone else, whatever the cookie says", async () => {
        as("admin")
        jar.scope = "c2"
        await get()
        expect(asked[0].companyId).toBeNull()
    })

    it("answers no one who isn't signed in", async () => {
        harness.session = null
        expect((await get()).status).toBe(401)
        expect(asked).toHaveLength(0)
    })

    it("counts the To review tab that waits, as the page opens it, with every kind and no filter", () => {
        const feed = stripComments(readFileSync("lib/requests/feed.ts", "utf8"))
        const counted = feed.slice(feed.indexOf("export async function waitingForReview"))
        expect(counted).toContain('tab: "review", show: "waiting", kind: "", search: "", personId: "", companyId,')
        // No company unless the Super Admin's route asks for the one they're looking at.
        expect(counted).toContain("companyId: string | null = null")
        // Through each kind's own rule and list, as the page's total is, so the two can't drift apart.
        expect(counted).toMatch(/SOURCES\.map\(/)
        expect(counted).toContain(".list(v, q, where, 0)")
    })
})

describe("the count on Requests", () => {
    const t = (key: string) => (en as Record<string, string>)[key] ?? key
    const viewer = (): SideBarViewer => {
        const p = permissionsOf(withGrants({ id: "u1", role: "ADMIN", companyId: "c1" }) as any)
        return { superAdmin: false, can: p.can, has: () => true, checkIn: false, companySettings: true, cashAdvances: false }
    }
    async function sideBar(waiting: number | undefined, locale: "en" | "ar" = "en") {
        ui.locale = locale
        const { default: SideBar } = await import("@/components/SideBar")
        return renderToStaticMarkup(h(SideBar, {
            groups: sideBarFor(viewer()), modules: modulesFrom(undefined, t as never), company: { name: "Nile Works", logoUrl: null },
            pathname: "/dashboard", drawer: false, open: false, onClose: () => {}, waiting,
        }))
    }
    const link = (html: string, href: string) => {
        const at = html.search(new RegExp(`<a[^>]*href="${href.replace(/\//g, "\\/")}"`))
        return html.slice(at, html.indexOf("</a>", at) + 4)
    }

    it("is a pill at the item's end, hidden from screen readers, which hear it with the name instead", async () => {
        const requests = link(await sideBar(3), "/dashboard/requests")
        expect(requests).toContain(`<span class="ui-side-label"><bdi>${en.requests}</bdi><span class="ui-visually-hidden">, 3 requests to review</span></span><span class="ui-side-count" aria-hidden="true">3</span>`)
        expect(en.side_bar_to_review).toBe(", {count} to review")
    })

    it("is in Arabic's own digits and words", async () => {
        const requests = link(await sideBar(3, "ar"), "/dashboard/requests")
        expect(requests).toContain('<span class="ui-visually-hidden">، ٣ طلبات للمراجعة</span>')
        expect(requests).toContain('<span class="ui-side-count" aria-hidden="true">٣</span>')
        expect(link(await sideBar(1, "ar"), "/dashboard/requests")).toContain('<span class="ui-visually-hidden">، طلب واحد للمراجعة</span>')
    })

    it("isn't there when nothing waits, or before it's known", async () => {
        for (const waiting of [0, undefined]) {
            const html = await sideBar(waiting)
            expect(html, String(waiting)).not.toContain("ui-side-count")
            expect(html, String(waiting)).not.toContain("to review")
        }
    })

    it("is on Requests alone", async () => {
        const html = await sideBar(5)
        expect(html.match(/ui-side-count/g)).toHaveLength(1)
        expect(link(html, "/dashboard/tasks")).not.toContain("ui-side-count")
    })

    it("is drawn in the brand colour, its digits even and kept to one line (components/ui/ui.css)", () => {
        const css = stripComments(readFileSync("components/ui/ui.css", "utf8"))
        const at = css.indexOf(".ui-side-count {")
        expect(at).toBeGreaterThan(-1)
        const rule = css.slice(at, css.indexOf("}", at))
        for (const part of ["margin-inline-start: auto;", "min-inline-size: 20px;", "block-size: 20px;", "border-radius: var(--radius-pill);", "background: var(--brand);", "color: var(--on-brand);", "font-size: var(--text-xs);", "font-variant-numeric: tabular-nums;", "white-space: nowrap;"]) {
            expect(rule, part).toContain(part)
        }
    })
})

describe("asking for it again", () => {
    const shell = stripComments(readFileSync("components/DashboardShell.tsx", "utf8"))
    const requests = stripComments(readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8"))

    it("on every page, on coming back to the window, and on looking at another company, for whoever has Requests in the side bar", () => {
        expect(shell).toContain("const waitingKey = groups.some(g => g.items.includes('requests')) ? WAITING_FOR_REVIEW_KEY : null")
        // Asked by the effect alone on the first paint, and once Requests is
        // there, rather than by SWR as well: one request, not two.
        expect(shell).toMatch(/useSWR<[^>]*>\(\s*waitingKey,\s*fetcher,\s*\{ revalidateOnMount: false, revalidateOnFocus: true \}/)
        expect(shell).toContain("const { selectedCompanyId } = useCompany()")
        expect(shell).toContain("useEffect(() => { void recheckWaiting() }, [pathname, waitingKey, selectedCompanyId, recheckWaiting])")
        expect(shell).toContain("waiting={waiting?.data?.count}")
    })

    it("once something is decided, deleted, withdrawn, revoked or asked for on the Requests page", () => {
        expect(requests).toContain("const { mutate } = useSWRConfig()")
        // Its own draw isn't shown as someone else's (lib/arrivals.test.ts).
        expect(requests).toContain("const refreshed = () => { arrivals.own(); router.refresh(); void mutate(WAITING_FOR_REVIEW_KEY) }")
        // Each of them refreshes the page through the one that asks again too.
        // Live updates' listener (REALTIME_PLAN.md, part 2) draws the page
        // alone: the side bar's count listens for itself.
        expect(requests).toContain("useLive('requests', () => router.refresh())")
        const actions = requests.replace("useLive('requests', () => router.refresh())", "")
        expect(actions.match(/router\.refresh\(\)/g)).toHaveLength(1)
        expect(requests.match(/refreshed\(\)/g)).toHaveLength(8)
    })
})

describe("the top bar's button for name changes alone", () => {
    it("is gone, with the count only it read", () => {
        const header = readFileSync("components/DashboardHeader.tsx", "utf8")
        expect(header).not.toContain("kind=nameChange&show=waiting")
        expect(header).not.toContain("pendingRequestsCount")
        expect(header).not.toContain("profile_name_requests")
        const bootstrap = readFileSync("lib/services/system.service.ts", "utf8")
        expect(bootstrap).not.toContain("pendingProfileRequests")
        expect(bootstrap).not.toContain("profileUpdateRequest.count")
    })

    it("leaves the dashboard's tile for them, for whoever decides them", () => {
        expect(readFileSync("app/(dashboard)/dashboard/page.tsx", "utf8")).toContain("href: '/dashboard/requests?tab=review&kind=nameChange&show=waiting'")
    })
})
