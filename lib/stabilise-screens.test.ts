import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

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
        expect(page).toContain("const nobodysEmployee = previewing || (session?.user as any)?.role === 'SUPER_ADMIN'")
        expect(page).toContain("useSWR(userId && !nobodysEmployee ? `/api/users/${userId}/payslips` : null, fetcher)")
    })

    it("and the Super Admin reaching it by its address isn't sent looking for payslips they don't have", () => {
        // The menu no longer offers it, but the address still opened the page,
        // which asked for the Super Admin's payslips and got a 404.
        const page = readFileSync("app/(dashboard)/dashboard/documents/page.tsx", "utf8")
        expect(page).toContain("(session?.user as any)?.role === 'SUPER_ADMIN'")
        expect(page).toContain("error || nobodysEmployee ? [] : null")
    })
})

/**
 * Found by visiting every page at phone width (390px) as each kind of user,
 * in both languages, and measuring what made the page scroll sideways.
 */
describe("at phone width", () => {
    it("a row of tabs scrolls by itself, not the whole page", () => {
        // The company settings tabs and the role-requests tabs ran past the
        // screen's edge, so the page could be dragged sideways.
        const toggle = readFileSync("components/SegmentedToggle.tsx", "utf8")
        expect(toggle).toContain("maxWidth: '100%',")
        expect(toggle).toContain("overflowX: 'auto',")
        expect(toggle).toContain("flexShrink: 0,")
        // and the chosen tab is kept in sight when the row scrolls
        expect(toggle).toContain("box.scrollBy(")
    })

    it("the task list's cards fit the screen", () => {
        // The list is a grid whose one column was sized to its widest card's
        // content: 380px of cards in a 326px space.
        const list = readFileSync("app/(dashboard)/dashboard/tasks/TasksClient.tsx", "utf8")
        expect(list).toContain("display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '1rem'")
    })

    it("the dashboard's grids never ask for more than the screen has", () => {
        // Their columns had fixed minimums up to 400px, so the Obligations
        // section on an Employee's dashboard was 400px in a 326px space.
        const page = readFileSync("app/(dashboard)/dashboard/page.tsx", "utf8")
        expect(page).not.toMatch(/minmax\(\d+px, 1fr\)/)
        expect(page).toContain("repeat(auto-fit, minmax(min(400px, 100%), 1fr))")
        // and the two small figures stack when two don't fit
        expect(page).not.toContain("gridTemplateColumns: '1fr 1fr'")
        expect(page).toContain("repeat(auto-fit, minmax(min(10rem, 100%), 1fr))")
    })

    it("no grid on any screen asks for a column wider than the screen has", () => {
        // A fixed minimum of 350px put the Employees, Day off and Requests
        // cards 350px wide in a 326px space, their right edge cut off.
        // min(Npx, 100%) is the same on a wide screen and gives way on a
        // narrow one.
        const screens = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
            e.isDirectory() ? screens(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])
        const fixed = [...screens("app"), ...screens("components")]
            .filter(f => /minmax\(\d+px, *1fr\)/.test(readFileSync(f, "utf8")))
        expect(fixed).toEqual([])
    })

    it("the Super Admin's four figures stack rather than run off the screen", () => {
        // Two to a row needed ~336px in a 326px column: the right-hand
        // tiles were cut off.
        const css = readFileSync("app/globals.css", "utf8")
        expect(css).not.toMatch(/minmax\(\d+px, *1fr\)/)
        const phone = css.slice(css.indexOf("@media (max-width: 480px)"))
        expect(phone.slice(0, 200)).toContain(".dashboard-stats-block {\n    grid-template-columns: minmax(0, 1fr);")
    })
})
