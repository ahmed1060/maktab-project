import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { serializeAccess, type Bundle } from "./bundles"

/**
 * What a page in the browser takes the company's package to be. Read from
 * the session hook alone, it was empty for the first second, and an empty
 * one includes everything: what the package leaves out showed, and went.
 */

const state = { session: { data: null as unknown, status: "loading" } }
vi.mock("next-auth/react", () => ({ useSession: () => state.session }))

const account = (...bundles: Bundle[]) => ({ id: "u1", role: "ADMIN", companyId: "c1", featureAccess: serializeAccess({ unrestricted: false, bundles: new Set(bundles) }) })

describe("the company's package, in the browser", () => {
    it("is the account the layout passed until the session has loaded, and then the session's", async () => {
        const { useFeatures } = await import("./useFeatures")
        const { ViewerProvider } = await import("@/lib/useCan")
        const Probe = () => { const f = useFeatures(); return h("p", null, `tasks ${f.has("TASKS")}, payroll ${f.has("PAYROLL")}`) }
        const paint = () => renderToStaticMarkup(h(ViewerProvider, { viewer: account("COMPANY_MANAGEMENT") as never, children: h(Probe) }))

        state.session = { data: null, status: "loading" }
        expect(paint()).toBe("<p>tasks true, payroll false</p>")

        state.session = { data: { user: account("HR") }, status: "authenticated" }
        expect(paint()).toBe("<p>tasks false, payroll true</p>")
    })
})
