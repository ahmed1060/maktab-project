import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The dashboard home on the building blocks (UI_PLAN.md §4.1). It's a server
 * page, so these read its source: what each person sees is decided by the
 * same checks as before, and the look is the building blocks'.
 */

const page = readFileSync("app/(dashboard)/dashboard/page.tsx", "utf8")

describe("the dashboard home", () => {
    it("names itself with the page header, in all four of its views", () => {
        expect(page.match(/<PageHeader\b/g)).toHaveLength(4)
        expect(page).not.toContain("HeaderSetter")
    })

    it("uses no Tailwind classes, emoji or inline styles", () => {
        expect(page).not.toMatch(/className="[^"]*\b(flex|text-2xl|font-bold|text-slate-\d+|py-\d+)\b/)
        expect(page).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
        expect(page).not.toContain("style={{")
    })

    it("counts tasks by every status there is, each a link to those tasks", () => {
        const schema = readFileSync("prisma/schema.prisma", "utf8")
        const statuses = schema.match(/enum TaskStatus \{([^}]*)\}/)![1].split(/\s+/).filter(Boolean)
        const listed = page.match(/const TASK_STATUSES = \[([^\]]*)\]/)![1].match(/'([A-Z_]+)'/g)!.map(s => s.slice(1, -1))
        expect([...listed].sort()).toEqual([...statuses].sort())
        // For a Team Leader, to the team's view of them (tasks/list-href.ts).
        expect(page).toContain("href: tasksListHref({ status, teamOnly: tasksTeamOnly })")
        // As donuts, with the words and counts in their legends.
        expect(page.match(/<DonutChart\b/g)).toHaveLength(1)
        // And the day off credit as a donut too (components/DayOffCreditDonut.tsx).
        expect(page).toContain("<DayOffCreditDonut ")
    })

    it("offers each review queue only to someone who can act on it, as before", () => {
        expect(page).toMatch(/can\(viewer, 'dayoff\.approve'\) \? \[\{ label: t\('pending_day_off_requests'\)/)
        expect(page).toMatch(/can\(viewer, 'profile_requests\.review'\) \? \[\{ label: t\('pending_profile_requests'\)/)
        expect(page).toMatch(/can\(viewer, 'employees\.create'\) && <ButtonLink href="\/dashboard\/employees\/new"/)
    })

    it("marks overdue tasks with the word, not only the colour", () => {
        expect(page).toContain('tone="overdue"')
        expect(page).toContain("<DueDate overdue>")
    })

    it("greets in the page's language, with its own comma", () => {
        // «مرحباً، سارة», not «مرحباً, سارة» put together from two strings.
        expect(page).toContain("t('hello_name').replace('{name}'")
        expect(page).not.toContain("`${t('hello')}, ")
    })

    it("writes numbers, dates and counts in the page's language", () => {
        expect(page).toContain("const numLocale = locale === 'ar' ? 'ar-EG' : 'en-GB'")
        expect(page).toContain("countOf(t, locale, n, 'days')")
        expect(page).not.toMatch(/toLocaleDateString\(locale === 'ar' \? 'ar-EG' : 'en-US'/)
    })
})
