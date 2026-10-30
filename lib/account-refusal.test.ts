import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { accountRefusal } from "./account-refusal"

/**
 * Whether a signed-in account may read or act at all: one rule, for the API
 * handler and for a page that reads the database itself, as the one Requests
 * page does (found by Codex on PR 125: it read the feed for a suspended
 * account, which the requests API had refused).
 */

const user = (fields: object = {}) => ({ role: "EMPLOYEE", userStatus: "ACTIVE", companyBanned: false, maintenanceMode: false, subscription: { state: "ACTIVE" }, ...fields })

describe("an account's refusal", () => {
    it("is none for an active account in a company in good standing", () => {
        expect(accountRefusal(user())).toBeNull()
    })

    it("is a suspension for a suspended or archived account, or a banned company", () => {
        expect(accountRefusal(user({ userStatus: "SUSPENDED" }))).toBe("SUSPENDED")
        expect(accountRefusal(user({ userStatus: "ARCHIVED" }))).toBe("SUSPENDED")
        expect(accountRefusal(user({ companyBanned: true }))).toBe("SUSPENDED")
    })

    it("is the subscription once it has lapsed, but never for the company's Admin, who renews it", () => {
        expect(accountRefusal(user({ subscription: { state: "LOCKED" } }))).toBe("SUBSCRIPTION")
        expect(accountRefusal(user({ role: "ADMIN", subscription: { state: "LOCKED" } }))).toBeNull()
    })

    it("is maintenance, for everyone but the Super Admin", () => {
        expect(accountRefusal(user({ maintenanceMode: true }))).toBe("MAINTENANCE")
        expect(accountRefusal(user({ role: "SUPER_ADMIN", maintenanceMode: true }))).toBeNull()
        // A suspension is said first, as the API says it.
        expect(accountRefusal(user({ maintenanceMode: true, userStatus: "SUSPENDED" }))).toBe("SUSPENDED")
    })

    it("is the API handler's rule, and the Requests page's before it reads anything", () => {
        expect(readFileSync("lib/api-utils.ts", "utf8")).toContain("const refusal = isHeartbeat ? null : accountRefusal(session.user)")
        const page = readFileSync("app/(dashboard)/dashboard/requests/page.tsx", "utf8")
        expect(page).toContain("if (accountRefusal(viewer)) return <AccessDenied />")
        expect(page.indexOf("accountRefusal(viewer)")).toBeLessThan(page.indexOf("requestFeed(viewer,"))
    })
})
