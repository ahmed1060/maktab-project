import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { accountRefusal } from "./account-refusal"
import { stripComments } from "./strip-comments"

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

    it("is every page's that reads the database itself, before it reads or writes anything", () => {
        // The proxy holds everyone off during maintenance or a locked subscription, but not a
        // suspended, archived or banned account with a session still live: the dashboard home,
        // the Tasks, Obligations and Costs pages and a record's page read for it, and a task's
        // and an obligation's marked themselves seen (found after PR 139).
        const pages = (readdirSync("app/(dashboard)", { recursive: true }) as string[])
            .filter(f => f.endsWith("page.tsx"))
            .map(f => join("app/(dashboard)", f))
        const reads = /\bprisma\.|\b[A-Z]\w*Service\.\w+\(|\brequestFeed\(/
        const unchecked: string[] = []
        let readers = 0
        for (const file of pages) {
            const src = stripComments(readFileSync(file, "utf8"))
            if (/^\s*['"]use client['"]/.test(src)) continue
            // The page itself: a helper above it runs only when the page calls it.
            const body = src.slice(Math.max(0, src.indexOf("export default")))
            const read = body.search(reads)
            if (read < 0) continue
            readers++
            const check = body.indexOf("accountRefusal(")
            if (check < 0 || check > read || !/accountRefusal\([^)]*\)\) return <AccessDenied \/>/.test(body)) unchecked.push(file)
        }
        expect(unchecked).toEqual([])
        // The guard reads what it means to: the Requests page and the seven found.
        expect(readers).toBeGreaterThanOrEqual(8)
    })
})
