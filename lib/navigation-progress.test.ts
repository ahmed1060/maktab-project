import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { historyLeavesPage, startsNavigation, type ClickLike } from "./navigation-progress"

/**
 * Something moves from the click that leaves a page until the next one is
 * there. Before, nothing did, and a link on a slow connection looked dead.
 */

const HERE = "https://nizmo.vercel.app/dashboard/tasks?view=my"
const click = (over: Partial<ClickLike> = {}): ClickLike => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...over })
const link = (href: string, extra: { target?: string; download?: boolean } = {}) =>
    ({ href, target: extra.target ?? "", hasAttribute: (n: string) => n === "download" && !!extra.download })

describe("which clicks start the bar", () => {
    it("a plain click on a link to another page of the site", () => {
        expect(startsNavigation(click(), link("/dashboard/obligations"), HERE)).toBe(true)
        expect(startsNavigation(click(), link("https://nizmo.vercel.app/dashboard/tasks?view=active"), HERE)).toBe(true)
    })

    it("not a click that opens it elsewhere, or a download", () => {
        for (const mod of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
            expect(startsNavigation(click({ [mod]: true }), link("/dashboard/obligations"), HERE)).toBe(false)
        }
        expect(startsNavigation(click({ button: 1 }), link("/dashboard/obligations"), HERE)).toBe(false)
        expect(startsNavigation(click(), link("/dashboard/obligations", { target: "_blank" }), HERE)).toBe(false)
        expect(startsNavigation(click(), link("/api/templates/raw", { download: true }), HERE)).toBe(false)
    })

    it("not one that goes nowhere: another site, the same page, a place on it", () => {
        expect(startsNavigation(click(), link("https://example.com/"), HERE)).toBe(false)
        expect(startsNavigation(click(), link(HERE), HERE)).toBe(false)
        expect(startsNavigation(click(), link("/dashboard/tasks?view=my#top"), HERE)).toBe(false)
        expect(startsNavigation(click({ defaultPrevented: true }), link("/dashboard/obligations"), HERE)).toBe(false)
    })
})

describe("the bar", () => {
    const bar = stripComments(readFileSync("components/NavigationProgress.tsx", "utf8"))
    const layout = readFileSync("app/layout.tsx", "utf8")
    const css = readFileSync("app/globals.css", "utf8")

    it("is on every page, and finishes when the address changes", () => {
        expect(layout).toMatch(/<Suspense fallback=\{null\}><NavigationProgress \/><\/Suspense>/)
        expect(bar).toMatch(/useAdjustOnChange\(\[pathname, search\]/)
        // Back and forward too, when they go to another page (review on #45).
        expect(bar).toMatch(/addEventListener\('popstate', onHistory\)/)
        expect(bar).toMatch(/if \(historyLeavesPage\(shown\.current, window\.location\)\) start\(\)/)
        // It can't be left running by a navigation that never arrives.
        expect(bar).toMatch(/GIVE_UP_MS/)
        expect(css).toMatch(/\.nav-progress\[data-state="loading"\]/)
        expect(css).toMatch(/\[dir="rtl"\] \.nav-progress/)
    })

    it("starts for the buttons that go back, which can't be links", () => {
        for (const f of ["app/(dashboard)/dashboard/employees/[id]/history/page.tsx", "app/(dashboard)/dashboard/profile-requests/page.tsx", "components/EmployeeProfileForm.tsx"]) {
            expect(readFileSync(f, "utf8"), f).toMatch(/startNavigationProgress\(\); router\.back\(\)/)
        }
    })

    it("buttons that only went to another page are links now", () => {
        // A link starts loading the page ahead of the click, and shows where it goes.
        const was: [string, string][] = [
            ["app/(dashboard)/dashboard/companies/page.tsx", "/payments`"],
            ["app/(dashboard)/dashboard/companies/page.tsx", "/settings`"],
            ["app/(dashboard)/dashboard/companies/[id]/payments/page.tsx", "'/dashboard/companies'"],
            ["app/(dashboard)/dashboard/employees/new/page.tsx", "'/dashboard/employees'"],
        ]
        for (const [file, to] of was) {
            const src = readFileSync(file, "utf8")
            expect(src, file).not.toContain(`onClick={() => router.push(${to.startsWith("/") ? "`/dashboard/companies/${company.id}" + to : to})}`)
            expect(src, file).toContain(`<Link href={${to.startsWith("/") ? "`/dashboard/companies/${company.id}" + to : to}}`)
        }
        // Create task's and Add obligation's Cancel are the building blocks' link that looks like a button.
        for (const [file, to] of [["app/(dashboard)/dashboard/tasks/new/page.tsx", "'/dashboard/tasks'"], ["app/(dashboard)/dashboard/obligations/new/page.tsx", "'/dashboard/obligations'"]]) {
            const src = readFileSync(file, "utf8")
            expect(src, file).not.toContain(`onClick={() => router.push(${to})}`)
            expect(src, file).toContain(`<ButtonLink href={${to}}>`)
        }
        // A task's page goes back to the list by its page header's back link, as an obligation's does.
        const taskPage = readFileSync("app/(dashboard)/dashboard/tasks/[id]/client.tsx", "utf8")
        expect(taskPage).not.toContain("router.back()")
        expect(taskPage).toContain("back={{ href: '/dashboard/tasks', label: modules.label('tasks') }}")
        // An obligation's page goes back to the list by its page header's back link.
        const obligation = readFileSync("app/(dashboard)/dashboard/obligations/[id]/client.tsx", "utf8")
        expect(obligation).not.toContain("onClick={() => router.push('/dashboard/obligations')}")
        expect(obligation).toContain("back={{ href: '/dashboard/obligations', label: modules.label('obligations') }}")
    })
})

describe("which steps through history start the bar", () => {
    const shown = { pathname: "/dashboard/tasks", search: "view=my" }

    it("one to another page, or the same page with other parameters", () => {
        expect(historyLeavesPage(shown, { pathname: "/dashboard/obligations", search: "" })).toBe(true)
        expect(historyLeavesPage(shown, { pathname: "/dashboard/tasks", search: "?view=active" })).toBe(true)
    })

    it("not one to another place on the same page, as back over the skip link is (review on #45)", () => {
        // The address bar's search starts with "?"; the app's own doesn't.
        expect(historyLeavesPage(shown, { pathname: "/dashboard/tasks", search: "?view=my" })).toBe(false)
    })
})
