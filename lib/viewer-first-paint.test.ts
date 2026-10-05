import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * Who is looking is known on the first paint.
 *
 * The session hook is empty for about the first second. Pages that gated on it
 * showed a Super Admin "Access Restricted", then a blank page, then the page —
 * three full renders, and on the Super Admins page the worst blocking time in
 * the Lighthouse audit (580 ms on a phone). The dashboard layout already hands
 * the signed-in user down (ViewerProvider); useViewer reads it until the
 * session has loaded.
 */

let session: { user: Record<string, unknown> } | null = null
let status: "loading" | "authenticated" | "unauthenticated" = "loading"
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: session, status }) }))

const { ViewerProvider, useViewer } = await import("./useCan")

function Probe() {
    const viewer = useViewer()
    return createElement("span", null, `${viewer?.role ?? "nobody"}:${viewer?.id ?? "-"}`)
}
const render = (viewer: Record<string, unknown> | null) =>
    renderToString(ViewerProvider({ viewer: viewer as never, children: createElement(Probe) }))

describe("useViewer", () => {
    beforeEach(() => { session = null; status = "loading" })

    it("is the layout's user while the session is still loading", () => {
        expect(render({ id: "u1", role: "SUPER_ADMIN" })).toContain("SUPER_ADMIN:u1")
    })

    it("is the session's user once it has loaded, since that one refreshes", () => {
        session = { user: { id: "u1", role: "ADMIN" } }
        status = "authenticated"
        expect(render({ id: "u1", role: "SUPER_ADMIN" })).toContain("ADMIN:u1")
    })

    it("is nobody once signed out or expired, whatever the layout drew with", () => {
        // The session is empty then too; the layout's copy must not keep a
        // Super Admin's page open in a tab whose session has ended.
        status = "unauthenticated"
        expect(render({ id: "u1", role: "SUPER_ADMIN" })).toContain("nobody:-")
    })

    it("is nobody outside the dashboard with no session", () => {
        expect(render(null)).toContain("nobody:-")
    })
})

describe("pages that refuse by role", () => {
    const pages = [
        "super-admins", "companies", "companies/[id]/settings", "companies/[id]/payments",
        "audit-logs", "system-settings", "profile-requests",
    ].map(p => `app/(dashboard)/dashboard/${p}/page.tsx`)

    it.each(pages)("%s doesn't refuse while the session loads", file => {
        const src = stripComments(readFileSync(file, "utf8"))
        expect(src).not.toMatch(/if \(!session/)
        expect(src).not.toMatch(/session\?\.user\?\.role/)
        expect(src).not.toMatch(/const loading = !session/)
    })
})
