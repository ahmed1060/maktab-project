import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Found by visiting every page as each kind of user, in both languages
 * (Super Admin, company Admin, Team Leader, Employee and a custom HR role),
 * and recording page errors and failed requests.
 */

describe("a page reached by typing its address", () => {
    it("New obligation tells somebody who may not create one so, instead of crashing", () => {
        // An Employee opening it asked for the colleague list, was refused,
        // and the page read .data of the refusal: a blank screen.
        const page = readFileSync("app/(dashboard)/dashboard/obligations/new/page.tsx", "utf8")
        expect(page).toContain("const mayCreate = useCan().can('obligations.manage')")
        expect(page).toContain("if (!mayCreate) return <AccessDenied />")
        expect(page).toContain("result?.data?.data || []")
    })
})

describe("the menu", () => {
    it("offers My payslips to people, not to the Super Admin, who has none", () => {
        const shell = readFileSync("components/DashboardShell.tsx", "utf8")
        const at = shell.indexOf('href="/dashboard/documents"')
        expect(shell.slice(at - 200, at)).toContain("user?.role !== 'SUPER_ADMIN' && (")
    })

    it("and while the Super Admin previews a role, shows it as the role would see it without asking for their payslips", () => {
        const page = readFileSync("app/(dashboard)/dashboard/documents/page.tsx", "utf8")
        expect(page).toContain("const previewing = !!(session?.user as any)?.preview")
        expect(page).toContain("useSWR(userId && !previewing ? `/api/users/${userId}/payslips` : null, fetcher)")
    })
})
