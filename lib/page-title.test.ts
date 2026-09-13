import { describe, it, expect } from "vitest"
import { resolveTitleKey, buildTitle, APP_NAME } from "@/lib/page-title"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

// The failure mode this guards is specific and ugly: a route mapped to a
// translation key that does not exist puts the raw key in the browser tab —
// "Nizmo — email_settings" — and nothing in typecheck or build notices, because
// the key is a string. Four of the keys in the first draft of this map were
// exactly that.

const ROUTES = [
    "/dashboard",
    "/dashboard/tasks",
    "/dashboard/tasks/abc-123",
    "/dashboard/obligations",
    "/dashboard/obligations/abc-123",
    "/dashboard/requests",
    "/dashboard/requests/history",
    "/dashboard/day-off-requests",
    "/dashboard/clients",
    "/dashboard/clients/abc/sections/def",
    "/dashboard/costs",
    "/dashboard/employees",
    "/dashboard/employees/abc/history",
    "/dashboard/vendors",
    "/dashboard/super-admins",
    "/dashboard/companies",
    "/dashboard/companies/abc/payments",
    "/dashboard/all-users",
    "/dashboard/audit-logs",
    "/dashboard/health",
    "/dashboard/system-settings",
    "/dashboard/email-settings",
    "/dashboard/mfa-settings",
    "/dashboard/profile-requests",
    "/dashboard/usernames",
    "/dashboard/maintenance",
]

describe("every route's title key exists in both locales", () => {
    for (const route of ROUTES) {
        it(route, () => {
            const key = resolveTitleKey(route)
            expect(key).not.toBeNull()
            expect(en, `missing "${key}" in en`).toHaveProperty(key!)
            expect(ar, `missing "${key}" in ar`).toHaveProperty(key!)
            expect(String((en as any)[key!]).length).toBeGreaterThan(0)
            expect(String((ar as any)[key!]).length).toBeGreaterThan(0)
        })
    }
})

describe("prefix resolution", () => {
    it("a longer prefix wins over a shorter one", () => {
        // /requests/history must not be swallowed by /requests.
        expect(resolveTitleKey("/dashboard/requests/history")).toBe("history")
        expect(resolveTitleKey("/dashboard/requests")).toBe("requests")
    })

    it("the bare dashboard does not swallow its children", () => {
        expect(resolveTitleKey("/dashboard")).toBe("dashboard")
        expect(resolveTitleKey("/dashboard/tasks")).toBe("tasks")
    })

    it("matches on a path segment, never a partial word", () => {
        // /dashboard/taskspecial is not the tasks page.
        expect(resolveTitleKey("/dashboard/taskspecial")).toBe("dashboard")
    })

    it("an unknown route outside the dashboard resolves to nothing", () => {
        expect(resolveTitleKey("/login")).toBeNull()
        expect(resolveTitleKey("/")).toBeNull()
    })
})

describe("buildTitle", () => {
    it("names the section after the product", () => {
        expect(buildTitle("Obligations")).toBe(`${APP_NAME} — Obligations`)
    })

    it("falls back to the bare product name rather than a dangling dash", () => {
        expect(buildTitle(null)).toBe(APP_NAME)
    })
})
