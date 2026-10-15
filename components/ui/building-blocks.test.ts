import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { createElement as h, Fragment } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MapPinIcon, PlusIcon } from "@phosphor-icons/react/ssr"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * The building blocks (DESIGN.md §5), rendered to HTML: what they promise
 * screen readers and keyboards, the right-to-left and token rules their
 * stylesheet keeps, and the small helpers behind them.
 */

let locale: "en" | "ar" = "en"
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale, t: (key: string) => (locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))

const ui = await import("@/components/ui")
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

beforeEach(() => { locale = "en" })

describe("the pager", () => {
    it("offers every page when there are seven or fewer", () => {
        expect(ui.pageWindow(1, 1)).toEqual([1])
        expect(ui.pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
    })

    it("keeps the first, the last and the current page's neighbours, and never more than seven", () => {
        expect(ui.pageWindow(1, 20)).toEqual([1, 2, 3, 4, null, 20])
        expect(ui.pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20])
        expect(ui.pageWindow(20, 20)).toEqual([1, null, 17, 18, 19, 20])
        for (let count = 1; count <= 40; count++) {
            for (let page = 1; page <= count; page++) {
                const w = ui.pageWindow(page, count)
                expect(w.length).toBeLessThanOrEqual(7)
                expect(w).toContain(page)
                expect(w[0]).toBe(1)
                expect(w[w.length - 1]).toBe(count)
            }
        }
    })

    it("marks the current page and can't go before the first", () => {
        const html = render(h(ui.Pager, { page: 1, pageCount: 3, onPage: () => {}, summary: "18 tasks" }))
        expect(html).toContain('aria-current="page"')
        expect(html).toMatch(/aria-label="Previous page" disabled=""/)
        expect(html).toContain('aria-label="Page 2 of 3"')
        expect(html).toContain("18 tasks")
        // The phone's "Page 1 of 3", shown in place of the numbers.
        expect(html).toContain('<span class="ui-pager-where" aria-hidden="true">Page 1 of 3</span>')
    })

    it("counts in Arabic-Indic digits in Arabic, and its arrows mirror", () => {
        locale = "ar"
        const html = render(h(ui.Pager, { page: 2, pageCount: 3, onPage: () => {} }))
        expect(html).toContain("صفحة ٢ من ٣")
        expect(html).toContain(">٢<")
        expect(html.match(/ui-flip/g)).toHaveLength(2)
    })
})

describe("lists", () => {
    type Row = { id: string; title: string; late: boolean }
    const rows: Row[] = [{ id: "a", title: "Renew register", late: true }, { id: "b", title: "Open account", late: false }]
    const columns = [
        { key: "task", header: "Task", cell: (r: Row) => h(ui.ItemTitle, { title: r.title, detail: "HQ", detailIcon: MapPinIcon }) },
        { key: "due", header: "Deadline", cell: (r: Row) => h(ui.DueDate, { overdue: r.late, children: "12 Oct" }) },
        { key: "act", header: "Actions", hideHeader: true, align: "end" as const, cell: () => h(ui.Button, { size: "sm", children: "View" }) },
    ]
    const list = (items: Row[]) => render(h(ui.DataList<Row>, {
        caption: "Tasks", columns, rows: items, rowKey: r => r.id,
        tone: r => r.late ? "overdue" : undefined,
        card: r => h(ui.ListCard, { title: r.title }),
        empty: h(ui.EmptyState, { icon: PlusIcon, title: "No tasks yet" }),
    }))

    it("is a table with a caption and column headers, and a card per row for phones", () => {
        const html = list(rows)
        expect(html).toContain('<caption class="ui-visually-hidden">Tasks</caption>')
        expect(html.match(/<th scope="col"/g)).toHaveLength(3)
        // The actions column's header is read out but not shown.
        expect(html).toContain('<span class="ui-visually-hidden">Actions</span>')
        expect(html).toContain('<ul class="ui-cards" aria-label="Tasks">')
        expect(html.match(/<li[ >]/g)).toHaveLength(2)
    })

    it("marks an overdue row in both views, with the word and not only the colour", () => {
        const html = list(rows)
        expect(html.match(/data-tone="overdue"/g)).toHaveLength(2)
        expect(html).toContain('data-overdue="true"')
        expect(html).toContain("Overdue")
        locale = "ar"
        expect(list(rows)).toContain("متأخرة")
    })

    it("keys each row and card, so a page can scroll to the one showing", () => {
        const html = list(rows)
        expect(html.match(/data-key="a"/g)).toHaveLength(2)
        expect(html).not.toMatch(/ id="a"/)
    })

    it("shows the empty state, and no table, when there's nothing", () => {
        const html = list([])
        expect(html).toContain("No tasks yet")
        expect(html).not.toContain("<table")
    })
})

describe("fields", () => {
    it("ties the label, the hint and the control together", () => {
        const html = render(h(ui.Field, { label: "Client name", hint: "As on the register", children: p => h(ui.TextInput, p) }))
        const id = html.match(/<label for="([^"]+)"/)![1]
        expect(html).toContain(`id="${id}"`)
        expect(html).toContain(`aria-describedby="${id}-hint"`)
        expect(html).toContain(`<span id="${id}-hint" class="ui-hint">`)
    })

    it("an error replaces the hint and marks the control invalid", () => {
        const html = render(h(ui.Field, { label: "Tax number", hint: "9 digits", error: "Enter the 9 digits", children: p => h(ui.TextInput, p) }))
        expect(html).toContain('aria-invalid="true"')
        expect(html).toContain("Enter the 9 digits")
        expect(html).not.toContain('class="ui-hint"')
    })

    it("a hidden label stays for screen readers", () => {
        const html = render(h(ui.Field, { label: "Status", hideLabel: true, children: p => h(ui.Select, { ...p, options: [{ value: "", label: "All statuses" }] }) }))
        expect(html).toContain('class="ui-visually-hidden">Status</label>')
    })
})

describe("buttons and icons", () => {
    it("a busy button says so and can't be pressed twice", () => {
        const html = render(h(ui.Button, { variant: "primary", busy: true, children: "Saving" }))
        expect(html).toContain('type="button"')
        expect(html).toContain('class="ui-btn ui-btn-primary"')
        expect(html).toContain('disabled=""')
        expect(html).toContain('aria-busy="true"')
    })

    it("an icon beside a word is hidden from screen readers; a labelled one is named", () => {
        expect(render(h(ui.Icon, { icon: PlusIcon }))).toContain('aria-hidden="true"')
        const named = render(h(ui.Icon, { icon: PlusIcon, label: "Add" }))
        expect(named).toContain('role="img"')
        expect(named).toContain('aria-label="Add"')
    })

    it("only directional icons mirror in Arabic", () => {
        expect(render(h(ui.Icon, { icon: PlusIcon }))).not.toContain("ui-flip")
        expect(render(h(ui.Icon, { icon: PlusIcon, directional: true }))).toContain("ui-flip")
    })
})

describe("statuses and people", () => {
    it("every task status has a meaning, so a new one can't arrive without a colour", () => {
        const schema = readFileSync("prisma/schema.prisma", "utf8")
        const statuses = schema.match(/enum TaskStatus \{([^}]*)\}/)![1].split(/\s+/).filter(Boolean)
        expect(statuses.length).toBeGreaterThan(0)
        for (const s of statuses) expect([s, ui.TASK_STATUS_TONE[s]]).toEqual([s, expect.any(String)])
    })

    it("a badge carries its word and its meaning's colour", () => {
        expect(render(h(ui.StatusBadge, { tone: "problem", children: "Rejected" }))).toBe('<span class="ui-badge ui-badge-problem">Rejected</span>')
    })

    it("initials come from the first two words, in any script", () => {
        expect(ui.initials("Mohamed Adel")).toBe("MA")
        expect(ui.initials("  sara   hassan ali ")).toBe("SH")
        // Kept apart, or م and ع join into the word «مع».
        expect(ui.initials("محمد عادل")).toBe("م\u200Cع")
        expect(ui.initials("Omar")).toBe("O")
    })

    it("a person with others shows how many more", () => {
        const html = render(h(Fragment, null, h(ui.Person, { names: ["Sara Hassan", "Omar Khaled", "Mona Ali"] })))
        expect(html).toContain("Sara Hassan")
        expect(html).toContain("+2")
        expect(html).not.toContain("Omar Khaled")
    })
})

describe("page layout, sections, rows and tiles", () => {
    it("the page header holds its buttons together on the end side", () => {
        const html = render(h(ui.PageHeader, { title: "Employees", action: h(ui.ButtonLink, { href: "/new", variant: "primary", children: "Add employee" }) }))
        expect(html).toContain('<h1 class="ui-page-title">Employees</h1>')
        expect(html).toMatch(/<div class="ui-page-actions"><a class="ui-btn ui-btn-primary" href="\/new">Add employee<\/a><\/div>/)
        expect(render(h(ui.PageHeader, { title: "Employees" }))).not.toContain("ui-page-actions")
    })

    it("a section is a heading over its panels", () => {
        const html = render(h(ui.Section, { title: "Needs your review", action: h(ui.SectionLink, { href: "/all", children: "View all" }), children: "x" }))
        expect(html).toContain('<section class="ui-section">')
        expect(html).toContain('<h2 class="ui-section-title">Needs your review</h2>')
        expect(html).toContain('<a class="ui-btn ui-btn-quiet ui-btn-sm" href="/all">View all</a>')
    })

    it("a row links to its item, with its detail and its end, and an overdue row says so", () => {
        const html = render(h(ui.Rows, { label: "Overdue tasks", children: [
            h(ui.Row, { key: "a", href: "/tasks/a", title: "Renew register", detail: "HQ", detailIcon: MapPinIcon, end: h(ui.DueDate, { overdue: true, children: "12 Oct" }), tone: "overdue" }),
            h(ui.Row, { key: "b", title: "Completed", end: "4" }),
        ] }))
        expect(html).toContain('<ul class="ui-panel ui-rows" aria-label="Overdue tasks">')
        expect(html).toMatch(/<li data-tone="overdue"><a class="ui-row" href="\/tasks\/a">/)
        expect(html).toContain('<span class="ui-item-title">Renew register</span>')
        expect(html).toContain("Overdue")
        // Without a link it's a plain row, not a link to nowhere.
        expect(html).toContain('<li><div class="ui-row">')
    })

    it("a tile can link to what it counts and carry a note", () => {
        const html = render(h(ui.TotalTiles, { items: [
            { label: "Task reviews", value: 3, href: "/dashboard/tasks?status=PENDING_CONFIRMATION" },
            { label: "Team bonuses", value: "2 days", note: "This month" },
        ] }))
        expect(html).toContain('<dt><a class="ui-tile-link" href="/dashboard/tasks?status=PENDING_CONFIRMATION">Task reviews</a></dt>')
        expect(html).toContain('<dd class="ui-tile-note">This month</dd>')
        expect(html.match(/ui-tile-link/g)).toHaveLength(1)
    })
})

describe("the row menu", () => {
    it("is a named button that says it opens a menu, and shows nothing until it's opened", () => {
        const html = render(h(ui.RowMenu, { label: "More actions for Sara Hassan", tooltip: "More actions", items: [
            { key: "edit", label: "Edit", href: "/e" },
            { key: "delete", label: "Delete", danger: true, onSelect: () => {} },
        ] }))
        expect(html).toContain('aria-label="More actions for Sara Hassan"')
        expect(html).toContain('title="More actions"')
        expect(html).toContain('aria-haspopup="menu"')
        expect(html).toContain('aria-expanded="false"')
        expect(html).not.toContain('role="menu"')
    })

    it("puts destructive items last, after a hairline", () => {
        const src = readFileSync("components/ui/Menu.tsx", "utf8")
        expect(src).toContain("const ordered = [...items.filter(i => !i.danger), ...items.filter(i => i.danger)]")
        expect(src).toMatch(/i === firstDanger && i > 0 && <div role="separator"/)
    })
})

describe("the stylesheet keeps the rules", () => {
    const css = readFileSync("components/ui/ui.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "")

    it("uses start and end, never left and right, so Arabic mirrors by itself", () => {
        expect(css).not.toMatch(/(margin|padding|border)-(left|right)\b/)
        expect(css).not.toMatch(/(^|[\s;{])(left|right)\s*:/m)
        expect(css).not.toMatch(/text-align:\s*(left|right)/)
    })

    it("takes its colours from the tokens", () => {
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
        const tsx = readdirSync("components/ui").filter(f => f.endsWith(".tsx"))
        for (const f of tsx) expect([f, /#[0-9a-fA-F]{6}\b/.test(readFileSync(`components/ui/${f}`, "utf8"))]).toEqual([f, false])
    })

    it("the menu is level 2 with menu corners, from their tokens", () => {
        expect(css).toMatch(/\.ui-menu \{[^}]*border-radius: var\(--radius-menu\);[^}]*box-shadow: var\(--elev-2\);/)
    })

    it("the old top bar hides its title on a page with a page header, so the page is named once", () => {
        expect(css).toMatch(/:root:has\(\.ui-page-header\) \.ui-topbar-title \{\s*display: none;/)
        expect(readFileSync("components/DashboardHeader.tsx", "utf8")).toMatch(/<div className="ui-topbar-title"[^>]*>\s*<h1/)
    })

    it("is loaded once, by the root layout", () => {
        expect(readFileSync("app/layout.tsx", "utf8")).toContain("import '@/components/ui/ui.css'")
    })
})

describe("the building blocks page", () => {
    it("is the Super Admin's only", () => {
        const page = readFileSync("app/(dashboard)/dashboard/ui-kit/page.tsx", "utf8")
        expect(page).toMatch(/if \(viewer\?\.role !== 'SUPER_ADMIN'\) return <AccessDenied \/>/)
    })
})
