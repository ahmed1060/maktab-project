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
    it("moves back to the last page there is when its page goes", () => {
        // The last person on page 4 deleted: three pages left.
        expect(ui.pageInRange(4, 3)).toBe(3)
        expect(ui.pageInRange(2, 3)).toBe(2)
        // Nothing left at all, or nothing loaded yet: page one.
        expect(ui.pageInRange(3, 0)).toBe(1)
        expect(ui.pageInRange(1, 0)).toBe(1)
    })

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

    it("scrolls a table wider than its panel inside it, instead of cutting off its end columns", () => {
        expect(list(rows)).toMatch(/<div class="ui-panel ui-list"><div class="ui-table-scroll"><table class="ui-table">/)
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-table-scroll \{\s*overflow-x: auto;/)
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

describe("text areas and choices", () => {
    it("a text area is a field, tied to its label like the others", () => {
        const html = render(h(ui.Field, { label: "Reason", hint: "100 characters left", children: p => h(ui.TextArea, { ...p, maxLength: 100 }) }))
        const id = html.match(/<label for="([^"]+)"/)![1]
        expect(html).toContain(`<textarea class="ui-input ui-textarea" id="${id}" aria-describedby="${id}-hint" maxLength="100">`)
    })

    it("a choice is radio buttons under a visible group label, and says why one can't be picked", () => {
        const html = render(h(ui.Choice<"CREDIT" | "SALARY">, {
            legend: "Deduct from", name: "from", value: "SALARY", onChange: () => {},
            options: [{ value: "CREDIT", label: "Day off credit", disabled: true }, { value: "SALARY", label: "Salary" }],
            warning: "Not enough credit",
        }))
        expect(html).toContain('<legend class="ui-label">Deduct from</legend>')
        expect(html.match(/type="radio"/g)).toHaveLength(2)
        expect(html).toContain('<label class="ui-choice" data-disabled="true"><input type="radio" class="ui-radio" disabled="" name="from" value="CREDIT"/>Day off credit</label>')
        expect(html).toContain('checked="" value="SALARY"')
        const warning = html.match(/<span id="([^"]+)" class="ui-error">Not enough credit<\/span>/)!
        expect(html).toContain(`<fieldset class="ui-choices" aria-describedby="${warning[1]}">`)
    })
})

describe("dialogs", () => {
    it("are nothing until opened", () => {
        expect(render(h(ui.Dialog, { open: false, onClose: () => {}, title: "Reject request", children: "x" }))).toBe("")
    })

    it("are labelled by their title, keep focus, and put the main button last", () => {
        const src = readFileSync("components/ui/Dialog.tsx", "utf8")
        expect(src).toContain("const dialog = useDialog(open, onClose)")
        expect(src).toContain('<h2 id={dialog.titleId} className="ui-dialog-title">{title}</h2>')
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-dialog \{[^}]*background: var\(--panel-raised\);[^}]*border-radius: var\(--radius-panel\);[^}]*box-shadow: var\(--elev-2\);/)
        // On a phone the buttons stack, the main (last) one on top.
        expect(css).toMatch(/\.ui-dialog-actions \{\s*flex-direction: column-reverse;/)
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

describe("the donut chart", () => {
    const parts = [
        { key: "done", label: "Completed", value: 3, tone: "good" as const, share: "75%", href: "/t?status=COMPLETED" },
        { key: "ok", label: "Approved", value: 1, tone: "good" as const, share: "25%" },
        { key: "late", label: "Rejected", value: 0, tone: "problem" as const, share: "0%" },
    ]
    const chart = (p = parts) => render(h(ui.DonutChart, { label: "Tasks by status", parts: p, total: "4", totalLabel: "Total", emptyLabel: "No data available" }))
    const css = readFileSync("components/ui/ui.css", "utf8")
    const ring = 2 * Math.PI * 44

    it("is a picture of its legend: the ring is hidden, the legend says every word, count and share", () => {
        const html = chart()
        expect(html).toContain('<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">')
        expect(html).toContain('<ul class="ui-donut-legend" aria-label="Tasks by status">')
        // Every part is in the legend, an empty one too, so the counts add up.
        for (const word of ["Completed", "Approved", "Rejected"]) expect(html).toContain(`<span class="ui-donut-label">${word}</span>`)
        expect(html).toContain('<span class="ui-donut-label">Completed</span> <span class="ui-donut-count">3</span> <span class="ui-donut-share">75%</span>')
        expect(html).toContain('<strong>4</strong><span>Total</span>')
    })

    it("has an arc for every part in the legend's order, so a row can pick out its own", () => {
        const html = chart()
        expect(html.match(/class="ui-donut-arc"/g)).toHaveLength(3)
        // The empty part's arc is there but not drawn, and its row steps back.
        expect(html).toMatch(/class="ui-donut-arc" data-tone="problem" data-empty="true"/)
        expect(html).toContain('<li data-empty="true">')
        for (let n = 1; n <= 8; n++) {
            expect(css).toContain(`.ui-donut:has(.ui-donut-legend > li:nth-child(${n}):is(:hover, :focus-within)) .ui-donut-arc:not(:nth-child(${n}))`)
        }
    })

    it("rounds each part's ends and leaves a clear gap between parts", () => {
        expect(ui.donutArcs([3, 1, 0])).toEqual([
            { dash: `${(ring * 3 / 4 - 13).toFixed(3).replace(/0+$/, "")} ${Number(ring.toFixed(3))}`, offset: -6.5 },
            { dash: `${Number((ring / 4 - 13).toFixed(3))} ${Number(ring.toFixed(3))}`, offset: -Number((ring * 3 / 4 + 6.5).toFixed(3)) },
            undefined,
        ])
        expect(css).toMatch(/\.ui-donut-arc \{\s*stroke: currentColor;\s*stroke-linecap: round;/)
        // A part too small for its ends is a dot, not a negative dash.
        expect(ui.donutArcs([1000, 1])[1]!.dash).toMatch(/^0 /)
    })

    it("fills the whole ring with one part alone", () => {
        expect(ui.donutArcs([0, 5, 0])).toEqual([undefined, {}, undefined])
        expect(chart([parts[0]])).not.toContain("stroke-dasharray")
    })

    it("gives a part repeating an earlier one's meaning a deeper shade, in the ring and the legend", () => {
        const html = chart()
        expect(html).toMatch(/class="ui-donut-arc" data-tone="good" cx=/)
        expect(html).toMatch(/class="ui-donut-arc" data-tone="good" data-shade="2"/)
        expect(html).toContain('<span class="ui-donut-mark" data-tone="good" data-shade="2" aria-hidden="true">')
    })

    it("draws in the chart colours, never the status text colours", () => {
        for (const tone of ["neutral", "progress", "waiting", "good", "problem"]) {
            expect(css).toContain(`.ui-donut [data-tone="${tone}"] { color: var(--chart-${tone}); }`)
            expect(css).toContain(`.ui-donut [data-tone="${tone}"][data-shade="2"] { color: color-mix(in srgb, var(--chart-${tone}) 65%, var(--ink)); }`)
        }
        expect(css.slice(css.indexOf("Donut chart (§5.5)"), css.indexOf("Empty state (§5.5)"))).not.toMatch(/--status-[a-z]+-fg/)
    })

    it("steps a long total down a size, so it stays clear of the ring", () => {
        expect(chart()).toContain('<div class="ui-donut-total"><strong>4</strong>')
        const days = render(h(ui.DonutChart, { label: "Credit", parts, total: "12 days", totalLabel: "Total", emptyLabel: "None" }))
        expect(days).toContain('<div class="ui-donut-total ui-donut-total-long"><strong>12 days</strong>')
        expect(css).toMatch(/\.ui-donut-total-long strong \{\s*font-size: var\(--text-xl\);/)
    })

    it("links a legend row to what it counts", () => {
        expect(chart()).toMatch(/<a class="ui-donut-row" href="\/t\?status=COMPLETED">/)
    })

    it("says when there's nothing to count, over a faint ring", () => {
        const html = chart(parts.map(p => ({ ...p, value: 0 })))
        expect(html).toContain('class="ui-donut-track"')
        expect(html).not.toContain("ui-donut-arc")
        expect(html).toContain('<p class="ui-donut-empty">No data available</p>')
    })

    it("only fades, quickly, and not at all with reduced motion", () => {
        const rules = css.slice(css.indexOf("Donut chart (§5.5)"), css.indexOf("Empty state (§5.5)"))
        expect(rules).not.toMatch(/animation|transform|transition: (stroke|all)/)
        expect(rules).toContain("transition: opacity 150ms ease-out;")
        const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"))
        expect(reduced.slice(0, reduced.indexOf("transition: none"))).toContain(".ui-donut-arc")
    })
})

describe("the selection bar", () => {
    it("says how many are picked, as it changes, with what can be done and Clear selection at the end", () => {
        const html = render(h(ui.SelectionBar, { count: "3 selected", clear: h(ui.Button, { variant: "quiet", children: "Clear selection" }), children: h(ui.Button, { variant: "primary", children: "Assign" }) }))
        expect(html).toContain('<span class="ui-selectionbar-count" aria-live="polite">3 selected</span>')
        expect(html.indexOf("Assign")).toBeLessThan(html.indexOf("Clear selection"))
        expect(html).toContain('<span class="ui-selectionbar-clear">')
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

    it("a page on the building blocks sits on the page colour, not the old moving gradient", () => {
        expect(css).toMatch(/:root:has\(\.ui-page\) body \{\s*background: var\(--page\);\s*animation: none;/)
        expect(css).toMatch(/:root:has\(\.ui-page\) body::before \{\s*display: none;/)
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
