import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { dayOffAddress } from "@/lib/requests/old-addresses"

/**
 * The Day off page sends people to the one Requests page (UI_PLAN.md §2.3,
 * part 2d): its links, notifications and the dashboard's tile land on Day
 * off there, as they did on it.
 */

describe("the Day off page's address", () => {
    it("is Day off on the Requests page", () => {
        expect(dayOffAddress({})).toBe("/dashboard/requests?kind=dayOff")
    })

    it("keeps the status it asked for, as Waiting or Done", () => {
        expect(dayOffAddress({ status: "PENDING" })).toBe("/dashboard/requests?kind=dayOff&show=waiting")
        expect(dayOffAddress({ status: "APPROVED" })).toBe("/dashboard/requests?kind=dayOff&show=done")
        expect(dayOffAddress({ status: "REJECTED" })).toBe("/dashboard/requests?kind=dayOff&show=done")
        // One that isn't a status is dropped, rather than passed on.
        expect(dayOffAddress({ status: "WHATEVER" })).toBe("/dashboard/requests?kind=dayOff")
    })

    it("keeps the request a notification picked out", () => {
        expect(dayOffAddress({ highlight: "d1" })).toBe("/dashboard/requests?kind=dayOff&highlight=d1")
    })

    it("is where the old page sends whoever opens it, on the server", () => {
        const page = readFileSync("app/(dashboard)/dashboard/day-off-requests/page.tsx", "utf8")
        expect(page).toContain("redirect(dayOffAddress(await props.searchParams))")
        expect(page).not.toContain("'use client'")
        // Its list's own helper went with it.
        expect(existsSync("app/(dashboard)/dashboard/day-off-requests/list-query.ts")).toBe(false)
    })
})

describe("the links to day off", () => {
    it("are a notification's, to its request on the Requests page", () => {
        const bell = readFileSync("components/NotificationBell.tsx", "utf8")
        expect(bell).toContain("router.push(`/dashboard/requests?kind=dayOff&highlight=${notification.relatedId}`)")
        expect(bell).not.toContain("/dashboard/day-off-requests")
    })

    it("are the dashboard's: the waiting ones under To review, and one's own on Mine", () => {
        const dashboard = readFileSync("app/(dashboard)/dashboard/page.tsx", "utf8")
        expect(dashboard).toContain("href: '/dashboard/requests?tab=review&kind=dayOff&show=waiting'")
        expect(dashboard).toContain('href="/dashboard/requests?tab=mine&kind=dayOff"')
        expect(dashboard).not.toContain("/dashboard/day-off-requests")
    })

    it("aren't the side bar's any more, which has the one Requests item (part 5c); an old address's layout still shows a company without Day off what it is", () => {
        expect(readFileSync("lib/modules.ts", "utf8")).not.toContain("/dashboard/day-off-requests")
        expect(readFileSync("app/(dashboard)/dashboard/day-off-requests/layout.tsx", "utf8")).toContain("guardModule('DAY_OFF')")
    })
})
